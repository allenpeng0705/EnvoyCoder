/**
 * The daemon's event bus, and the port the family's transport subscribes through.
 *
 * ## Why a bus rather than a direct call into the transport
 *
 * The transport does not expose "send this event to every client". It exposes the opposite:
 * `HostNodeService.on(name, listener)` — *it* subscribes to *us*, once per event name in the
 * disposition table, when it starts (`@envoymesh/host-connect/src/ws-server.ts:471-479`). So a
 * product publishes events by emitting them from the object it handed over as the node surface.
 *
 * That inversion is why this module is small and why it is a separate file: it is the adapter
 * between "the daemon has something to say" and "the transport decides who hears it". Delivery
 * policy — broadcast, per-profile, or dropped — stays entirely on the transport's side of the port.
 *
 * ## Emission is not awaited, and cannot fail a caller
 *
 * A listener here is a socket write in another module. If one throws, the store mutation that
 * caused the event has *already* succeeded, and failing it retroactively would be a lie: the write
 * is on disk. So listeners are called synchronously and their errors are swallowed, one by one, so
 * that a single bad subscriber cannot silence the rest.
 *
 * ## The subscription set is deliberately not filtered
 *
 * Every event is offered to whoever subscribed by name. Deciding "could this client see this?"
 * here would mean this module knowing about sessions, scopes and ownership — which is the
 * transport's job, and the reason the family split the disposition table out of the server in the
 * first place. What this module knows is: a thing happened, and this is its name.
 */

import type { HostNodeService, SocketMethodPort } from "@envoycoder/host-bridge";

import {
  CODER_EVENTS,
  CODER_SUBSCRIBE_METHOD,
  type CoderEventName,
  coderError,
  ENVOYCODER_ERRORS,
  isCoderEventName,
} from "@envoycoder/protocol";

export interface CoderEventBus {
  /** Publish an event. Never throws, and never blocks. */
  emit(event: CoderEventName, data: unknown): void;
  /** Subscribe by name. Returns an unsubscribe function. */
  on(event: string, listener: (data: unknown) => void): () => void;
  /** How many listeners one event has. Used by the boot line, and by tests. */
  listenerCount(event: string): number;
}

export function createCoderEventBus(): CoderEventBus {
  const listeners = new Map<string, Set<(data: unknown) => void>>();

  return {
    emit(event, data) {
      const set = listeners.get(event);
      if (!set) return;
      for (const listener of [...set]) {
        try {
          listener(data);
        } catch {
          // One subscriber's failure must not stop the others: the state change it is being told
          // about has already happened, so there is nothing to roll back and nobody to tell.
        }
      }
    },
    on(event, listener) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(event);
      };
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

/**
 * Present the bus as the node surface the transport subscribes to.
 *
 * Four of the five members are honest no-ops, and each says why:
 *
 *   * `getNodeStatus` — this host *is* running; that is what serving means. It is not reporting the
 *     mesh node's state, because an EnvoyCoder daemon serves its windows whether or not a mesh node
 *     exists on this machine (a refusal to attach is a state to report, not a failure to start).
 *   * `getConnectionStatus` — empty, deliberately. EnvoyCoder has no peer id of its own: when it
 *     attaches to the mesh it holds a *product session*, and advertising the node's peer id as ours
 *     would claim an identity the node owns.
 *   * `onCallEvent` — voice/video signalling, which this product does not have. Returning a no-op
 *     unsubscribe rather than omitting the member keeps the port satisfied without a cast.
 *   * `noteClientActivity` — presence bookkeeping for a social product. Nothing here depends on
 *     whether a window is "active", and inventing a use would be worse than saying so.
 */
export function createNodeService(bus: CoderEventBus): HostNodeService {
  return {
    on(event, listener) {
      bus.on(event, listener);
    },
    onCallEvent() {
      return () => undefined;
    },
    getNodeStatus() {
      return "running";
    },
    getConnectionStatus() {
      return { peerId: "", multiaddrs: [] };
    },
    noteClientActivity() {
      // Deliberately empty: see the doc above.
    },
  };
}

/**
 * The subscription port: how a client asks to hear this daemon's events.
 *
 * ## Why this exists at all
 *
 * The transport's broadcast path needs an event-disposition table, and the surface a product is told
 * to use does not forward one — `@envoymesh/reuse-host`'s `createReuseHost` drops
 * `eventDispositions` on the floor (`packages/reuse-host/src/index.ts:242-252`). The full reasoning,
 * with the citation, is in `@envoycoder/protocol`'s `CODER_EVENTS` doc; the short version is that
 * `socketMethods` **is** forwarded, so this is the port that works, and a client subscribing to what
 * it renders is what we wanted anyway.
 *
 * ## Why the port is consulted for every method
 *
 * `socketMethods.handle` is called for *every* message that reaches it, before the dispatcher, and
 * answers `true` only for the methods it owns. So the first line here is a guard, not a formality:
 * returning `true` for anything else would silently swallow every RPC in the app, and the symptom
 * would be a window that loads and then does nothing.
 *
 * ## One subscription per connection, replaced on re-subscribe
 *
 * A client that subscribes twice replaces its subscription rather than doubling it — otherwise a
 * reconnect loop is how a desktop ends up rendering every event three times, and the bug looks like
 * a transcript that repeats itself. `closed` releases it, which is why the port has that member at
 * all: the transport tears the socket down, and a proxy that never hears about it leaks a listener
 * per reconnect.
 */
export function createCoderSocketMethods(bus: CoderEventBus): SocketMethodPort {
  const perConnection = new WeakMap<object, () => void>();

  return {
    async handle(context) {
      if (context.method !== CODER_SUBSCRIBE_METHOD) return false;

      const requested = (context.params as { events?: unknown }).events;
      let wanted: CoderEventName[];
      if (requested === undefined) {
        wanted = [...CODER_EVENTS];
      } else if (Array.isArray(requested) && requested.every((name) => typeof name === "string" && isCoderEventName(name))) {
        wanted = requested as CoderEventName[];
      } else {
        // Fail closed and say why: an unknown event name is a client built against a different
        // protocol version, and silently subscribing it to nothing would look like a dead daemon.
        throw coderError(
          ENVOYCODER_ERRORS.badRequest,
          `${CODER_SUBSCRIBE_METHOD} was asked for an event this daemon does not publish. It publishes: ${CODER_EVENTS.join(", ")}.`,
        );
      }

      perConnection.get(context.connection)?.();
      const unsubscribe = wanted.map((event) =>
        bus.on(event, (data) => {
          context.send(event, data);
        }),
      );
      perConnection.set(context.connection, () => {
        for (const off of unsubscribe) off();
      });

      context.ok({ subscribed: wanted });
      return true;
    },

    closed(connection) {
      perConnection.get(connection)?.();
      perConnection.delete(connection);
    },
  };
}
