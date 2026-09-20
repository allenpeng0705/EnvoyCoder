/// Which machines this phone can reach, and how each one is doing — now a sheet, not a page.
///
/// It was the app's first screen and no longer is: the owner's point is that a phone paired to one
/// desktop should open on that desktop's work, and a list whose only job is to be tapped through is
/// a tax on every launch. The list itself is not the problem — "how is it doing" still matters — so
/// it survives behind the top bar's **connection name**, which is now what opens it, with the same
/// status dots, the same route label, and one addition: a way to forget a host, which
/// `HostStore.remove` has always supported and no screen ever offered.
///
/// **The cell tower came off the rows.** Each row used to carry its own button for the network-status
/// ladder; the owner asked for that glyph to move up to the top bar and report the *active* host's
/// health there. So the row is back to what a row should be — a dot, a name, the address and the
/// route in use, `· via <route>` — and the ladder is one tap away for the host the app is actually
/// on (tap the row to make it active, then tap the top-bar icon).
///
/// A sheet rather than a page, deliberately: switching host is a detour, not a destination, and a
/// sheet returns the user to the work they were looking at instead of pushing a second page they
/// then have to back out of. `useRootNavigator` puts it above whatever route is open (the run screen,
/// settings) so the top bar's name reaches it from anywhere.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/l10n.dart';
import '../models/host.dart';
import '../services/connections_controller.dart';
import '../services/host_client.dart';
import '../services/host_pairing_flow.dart';
import '../theme/tokens.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/name_dialog.dart';

Future<void> showConnectionsSheet(BuildContext context, ConnectionsController controller) {
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    showDragHandle: true,
    isScrollControlled: true,
    builder: (_) => ConnectionsSheet(controller: controller),
  );
}

class ConnectionsSheet extends StatefulWidget {
  const ConnectionsSheet({super.key, required this.controller});

  final ConnectionsController controller;

  @override
  State<ConnectionsSheet> createState() => _ConnectionsSheetState();
}

class _ConnectionsSheetState extends State<ConnectionsSheet> {
  /// True while this sheet is the one on top, so the pairing flow's own navigation stays inside it.
  ///
  /// Pushing the QR scanner onto the *root* navigator while this sheet is open would cover the sheet
  /// and then return the code to a dead context. `rootNavigator: false` sends the push to the sheet's
  /// own route, which is what makes Scan QR work from inside a sheet at all.
  Future<void> _addHost() async {
    final added = await addHostFlow(context, widget.controller.store);
    if (added == null || !mounted) return;
    await widget.controller.upsertHost(added);
    if (mounted) setState(() {});
  }

  /// Rename one connection: a purely local edit, persisted by the controller.
  ///
  /// The name is the phone's own word for the machine (see `ConnectionsController.renameHost`), so
  /// there is no RPC behind this — the write is `HostStore.upsert` and nothing leaves the phone. The
  /// dialog refuses a blank name outright: this is the *rename* path, where the field already holds a
  /// real name, and clearing it would be a way to make the list anonymous.
  Future<void> _rename(CoderHost host) async {
    final l10n = context.l10n;
    final name = await showNameDialog(
      context,
      title: l10n.connectionsRenameTitle,
      fieldLabel: l10n.connectionsRenameField,
      initialValue: host.label,
      confirmLabel: l10n.commonRename,
      emptyError: l10n.connectionsRenameEmpty,
      // The same bound the pairing step uses, from the one constant that defines it.
      maxLength: kConnectionNameMaxLength,
    );
    if (name == null || !mounted) return;
    if (name == host.label) return;
    await widget.controller.renameHost(host.id, name);
    if (mounted) setState(() {});
  }

  Future<void> _forget(CoderHost host) async {
    // Named in user language and in that order: what is lost (the pairing), then what is not
    // (the work). "Revoke token" would be the log's word, not the user's. The dialog itself is the
    // app's one shared confirmation — see `widgets/confirm_dialog.dart`.
    final l10n = context.l10n;
    final confirmed = await showConfirmDialog(
      context,
      title: l10n.connectionsForgetTitle(host.label),
      message: l10n.connectionsForgetMessage,
      confirmLabel: l10n.connectionsForgetConfirm,
    );
    if (!confirmed || !mounted) return;
    await widget.controller.forget(host);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    final colors = CoderTheme.of(context);
    final controller = widget.controller;
    final hosts = controller.hosts;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(CoderSpace.lg, 0, CoderSpace.md, CoderSpace.sm),
            child: Row(
              children: [
                // `Expanded` rather than a `Spacer`: the title is a translated word, and German's
                // "Verbindungen" overflowed this Row by 8.1pt at 320pt when it sized naturally. The
                // count keeps its width; the title yields.
                Expanded(
                  child: Text(
                    l10n.connectionsTitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(width: CoderSpace.sm),
                Text(
                  l10n.connectionsCount(hosts.length),
                  style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          // **Add host leads the list.** The top bar's Add-host shortcut is gone (one home for
          // pairing, and this is it), and the owner asked for it first rather than last: the action
          // a user opens this sheet to reach should not sit below the machines. It stays a `ListTile`
          // with the `add` glyph and the "Scan a code, or enter an address" line, and it sits above
          // the divider that separates it from the machines — no status dot, no `…` — so it reads as
          // the sheet's one *action* and not as another connection.
          ListTile(
            leading: const Icon(Icons.add),
            title: Text(l10n.connectionsAddHost),
            subtitle: Text(l10n.connectionsAddHostSubtitle),
            onTap: () => unawaited(_addHost()),
          ),
          const Divider(),
          if (hosts.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md, CoderSpace.lg, CoderSpace.lg),
              child: Text(
                l10n.connectionsEmpty,
                style: TextStyle(color: colors.foregroundMuted),
              ),
            )
          else
            // The sheet is a `mainAxisSize.min` column, so its height is unbounded until the modal's
            // own constraint applies — and a `ListView` needs a bounded height to lay out at all. The
            // cap is what keeps a long host list scrollable instead of throwing at paint time.
            ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: MediaQuery.sizeOf(context).height * 0.5,
              ),
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final host in hosts)
                    _HostRow(
                      host: host,
                      active: controller.isActive(host.id),
                      state: controller.stateOf(host.id),
                      route: controller.routeOf(host.id),
                      colors: colors,
                      onTap: () async {
                        await controller.setActive(host);
                        if (context.mounted) Navigator.of(context).pop();
                      },
                      onForget: () => unawaited(_forget(host)),
                      onRename: () => unawaited(_rename(host)),
                    ),
                ],
              ),
            ),
          const SizedBox(height: CoderSpace.md),
        ],
      ),
    );
  }
}

class _HostRow extends StatelessWidget {
  const _HostRow({
    required this.host,
    required this.active,
    required this.state,
    required this.route,
    required this.colors,
    required this.onTap,
    required this.onForget,
    required this.onRename,
  });

  final CoderHost host;
  final bool active;
  final HostConnectionState state;
  final String? route;
  final CoderColors colors;
  final VoidCallback onTap;
  final VoidCallback onForget;
  final VoidCallback onRename;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    // The active host is marked, not decorated: a user opening this sheet to answer "which one am I
    // on?" should not have to compare two lists.
    //
    // **The row leads with the name and demotes the address.** It used to be the other way round in
    // effect — the title was whatever `label` held, and `pairing_service.dart` filled that from the
    // code's host, so two machines read as `192.168.1.4` and `192.168.1.9`. Now a name set while
    // pairing (or renamed here) is the title, and the address keeps its place on the detail line:
    // still visible because it is the diagnostic fact the networking panel keys off, but no longer
    // the thing a user has to tell two computers apart by.
    final title = active ? l10n.connectionsCurrent(host.label) : host.label;
    return ListTile(
      leading: _stateDot(state, colors),
      // Single line and ellipsized, like the top bar: a connection name is user-set and the sheet is
      // not wide enough to guarantee even a legal 40-character one fits. The tooltip carries the
      // full name, so a long-press recovers what the glyphs had to drop; the `Text`'s own semantics
      // are the untruncated string, so a screen reader gets it whole too.
      title: Tooltip(
        message: host.label,
        child: Text(
          title,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(fontWeight: active ? FontWeight.w600 : null),
        ),
      ),
      // The address, then the route in use: naming *how* the phone is connected rather than only its
      // health is the one idea worth taking from Paseo's host page (a badge that says `Relay` /
      // `Local` / `Remote SSH`) — a user who can see *how* they are connected can act on a slow link,
      // while "Connected" alone tells them nothing they can use. Empty until a dial wins, and empty
      // again after a reconnect outside the ladder: at that point no rung is in use, and naming one
      // would be a guess. The whole ladder lives on the **active** host's cell tower in the top bar,
      // not on these rows — the dot and this line are what the row has to say about health.
      subtitle: Text(
        route == null
            ? l10n.connectionsRowDetail(host.endpoint, state.labelFor(l10n))
            : l10n.connectionsRowDetailVia(host.endpoint, state.labelFor(l10n), route!),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      // Rename and Forget are behind the `…`. The row used to carry a third, read-only control — the
      // cell tower that opened the ladder — and that is the one the owner moved to the top bar, so the
      // row is down to one trailing control. The rule the project row set still holds: the row keeps
      // the gesture that *acts* on it (tap to switch), and the menu carries the rest.
      trailing: _HostOverflowMenu(
        hostLabel: host.label,
        destructive: colors.destructive,
        onRename: onRename,
        onForget: onForget,
      ),
      onTap: onTap,
    );
  }

  Widget _stateDot(HostConnectionState state, CoderColors colors) {
    final color = switch (state) {
      HostConnectionState.connected => colors.statusDotSuccess,
      HostConnectionState.connecting => colors.statusDotRunning,
      HostConnectionState.reconnecting => colors.statusDotWarning,
      HostConnectionState.failed => colors.statusDotDanger,
      HostConnectionState.idle => colors.foregroundExtraMuted,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
    );
  }
}

/// Which item of a host row's `…` was chosen.
enum _HostMenuAction { rename, forget }

/// A connection row's `…`: Rename this connection, or Forget it.
///
/// **Why a menu and not more icons.** Three icon buttons overflowed the row by 16pt at 320pt, and
/// the project row already settled the rule: the row keeps the gesture that acts on it, secondaries
/// behind the trigger (`project_list_screen.dart`'s `_ProjectOverflowMenu`). The read-only status
/// button has since moved to the top bar entirely, so this menu is the row's *only* trailing control;
/// keeping Rename and Forget here is still right, because both change the connection and neither is
/// what a tap on the row is for.
///
/// Rename is **local** — `ConnectionsController.renameHost` writes `HostStore`, and no RPC exists for
/// a label the phone itself owns — while Forget still leads to the same confirmation it always did.
/// The destructive item is last and wears the danger colour, exactly as "Remove project" does.
class _HostOverflowMenu extends StatelessWidget {
  const _HostOverflowMenu({
    required this.hostLabel,
    required this.destructive,
    required this.onRename,
    required this.onForget,
  });

  final String hostLabel;
  final Color destructive;
  final VoidCallback onRename;
  final VoidCallback onForget;

  @override
  Widget build(BuildContext context) {
    final l10n = context.l10n;
    return Semantics(
      label: l10n.connectionsMenuAria(hostLabel),
      button: true,
      child: PopupMenuButton<_HostMenuAction>(
        tooltip: l10n.connectionsMenuAria(hostLabel),
        onSelected: (action) => switch (action) {
          _HostMenuAction.rename => onRename(),
          _HostMenuAction.forget => onForget(),
        },
        itemBuilder: (context) => [
          PopupMenuItem(
            value: _HostMenuAction.rename,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.edit_outlined),
              title: Text(l10n.connectionsRenameTitle),
            ),
          ),
          const PopupMenuDivider(),
          PopupMenuItem(
            value: _HostMenuAction.forget,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.link_off, color: destructive),
              title: Text(l10n.connectionsMenuForget),
            ),
          ),
        ],
      ),
    );
  }
}
