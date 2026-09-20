/// Which machines this phone can reach, and how each one is doing — now a sheet, not a page.
///
/// It was the app's first screen and no longer is: the owner's point is that a phone paired to one
/// desktop should open on that desktop's work, and a list whose only job is to be tapped through is
/// a tax on every launch. The list itself is not the problem — "how is it doing" still matters — so
/// it survives behind the top bar's **Connections** button, with the same status dots, the same
/// route label, and one addition: a way to forget a host, which `HostStore.remove` has always
/// supported and no screen ever offered.
///
/// A sheet rather than a page, deliberately: switching host is a detour, not a destination, and a
/// sheet returns the user to the work they were looking at instead of pushing a second page they
/// then have to back out of. `useRootNavigator` puts it above whatever route is open (the run screen,
/// settings) so the top bar's button reaches it from anywhere.
library;

import 'dart:async';

import 'package:flutter/material.dart';

import '../models/host.dart';
import '../services/connections_controller.dart';
import '../services/host_client.dart';
import '../services/host_pairing_flow.dart';
import '../theme/tokens.dart';
import '../widgets/confirm_dialog.dart';
import '../widgets/name_dialog.dart';
import 'network_status_screen.dart';

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

  /// Open the network-status panel for [host], leaving this sheet in place underneath.
  ///
  /// The sheet itself is on the root navigator (`showConnectionsSheet` uses `useRootNavigator: true`
  /// so the top bar's button reaches it from any route), so pushing from this context stacks the
  /// panel above the sheet and backing out of the panel returns here — where the other computers and
  /// their dots still are. It deliberately does **not** close the sheet first: the panel is a detail
  /// of one row, and dropping the list to show it would make coming back a second tap.
  Future<void> _openStatus(ConnectionsController controller, CoderHost host) async {
    final client = controller.clientOf(host.id);
    if (client == null) return;
    await showNetworkStatus(context, client);
  }

  /// Rename one connection: a purely local edit, persisted by the controller.
  ///
  /// The name is the phone's own word for the machine (see `ConnectionsController.renameHost`), so
  /// there is no RPC behind this — the write is `HostStore.upsert` and nothing leaves the phone. The
  /// dialog refuses a blank name outright: this is the *rename* path, where the field already holds a
  /// real name, and clearing it would be a way to make the list anonymous.
  Future<void> _rename(CoderHost host) async {
    final name = await showNameDialog(
      context,
      title: 'Rename connection',
      fieldLabel: 'Connection name',
      initialValue: host.label,
      confirmLabel: 'Rename',
      emptyError: 'Enter a name for this connection.',
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
    final confirmed = await showConfirmDialog(
      context,
      title: 'Forget ${host.label}?',
      message: 'This phone will stop connecting to that computer and forget its pairing. '
          'Tasks already running there keep running.',
      confirmLabel: 'Forget',
    );
    if (!confirmed || !mounted) return;
    await widget.controller.forget(host);
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
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
                Text('Connections', style: Theme.of(context).textTheme.titleMedium),
                const Spacer(),
                Text(
                  hosts.length == 1 ? '1 computer' : '${hosts.length} computers',
                  style: TextStyle(color: colors.foregroundMuted, fontSize: 12),
                ),
              ],
            ),
          ),
          if (hosts.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(CoderSpace.lg, CoderSpace.md, CoderSpace.lg, CoderSpace.lg),
              child: Text(
                'No desktop paired yet.',
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
                      // The row already answers "how is it doing?"; this is the next question, so it
                      // hangs off the row rather than off the sheet (the host is what has a route).
                      // Null for a host whose client the controller has not built yet — the button
                      // then simply is not offered, instead of opening an empty panel.
                      onStatus: controller.clientOf(host.id) == null
                          ? null
                          : () => unawaited(_openStatus(controller, host)),
                    ),
                ],
              ),
            ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.add),
            title: const Text('Add host'),
            subtitle: const Text('Scan a code, or enter an address'),
            onTap: () => unawaited(_addHost()),
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
    this.onStatus,
  });

  final CoderHost host;
  final bool active;
  final HostConnectionState state;
  final String? route;
  final CoderColors colors;
  final VoidCallback onTap;
  final VoidCallback onForget;
  final VoidCallback onRename;

  /// Opens the network-status panel, or null when there is no client to read yet.
  final VoidCallback? onStatus;

  @override
  Widget build(BuildContext context) {
    // The active host is marked, not decorated: a user opening this sheet to answer "which one am I
    // on?" should not have to compare two lists.
    //
    // **The row leads with the name and demotes the address.** It used to be the other way round in
    // effect — the title was whatever `label` held, and `pairing_service.dart` filled that from the
    // code's host, so two machines read as `192.168.1.4` and `192.168.1.9`. Now a name set while
    // pairing (or renamed here) is the title, and the address keeps its place on the detail line:
    // still visible because it is the diagnostic fact the networking panel keys off, but no longer
    // the thing a user has to tell two computers apart by.
    final title = active ? '${host.label} · current' : host.label;
    return ListTile(
      leading: _stateDot(state, colors),
      title: Text(title, style: TextStyle(fontWeight: active ? FontWeight.w600 : null)),
      // The address, then the route in use: naming *how* the phone is connected rather than only its
      // health is the one idea worth taking from Paseo's host page (a badge that says `Relay` /
      // `Local` / `Remote SSH`) — a user who can see *how* they are connected can act on a slow link,
      // while "Connected" alone tells them nothing they can use. Empty until a dial wins, and empty
      // again after a reconnect outside the ladder: at that point no rung is in use, and naming one
      // would be a guess. The whole ladder is behind the cell-tower button.
      subtitle: Text(
        '${host.endpoint} · ${state.label}${route == null ? '' : ' · via $route'}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (onStatus != null)
            // Icon-only, so tooltip **and** Semantics label — the rule `Forget host` set. The
            // tooltip names the computer, because two rows sit inches apart and "Network status"
            // alone does not say whose. It stays on the row rather than in the menu because it is the
            // row's *next question* — "how is it doing?" then "how is it connected?" — and a
            // diagnostic detail one tap deeper would be read less.
            Semantics(
              label: 'Network status for ${host.label}',
              button: true,
              child: IconButton(
                tooltip: 'Network status for ${host.label}',
                icon: Icon(Icons.cell_tower, color: colors.foregroundMuted),
                onPressed: onStatus,
              ),
            ),
          // Rename and Forget are behind the `…`, for the same reason the project row keeps two
          // controls and no more: three icon buttons overflowed this row by 16pt at 320pt. The two
          // that moved are the two that *change* the connection — a local rename, and a forget with a
          // confirmation behind it — while the read-only diagnostic kept its place.
          _HostOverflowMenu(
            hostLabel: host.label,
            destructive: colors.destructive,
            onRename: onRename,
            onForget: onForget,
          ),
        ],
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
/// **Why a menu and not two more icons.** Three icon buttons overflowed the row by 16pt at 320pt, and
/// the project row already settled the rule: two trailing controls, secondaries behind the trigger
/// (`project_list_screen.dart`'s `_ProjectOverflowMenu`). The read-only "how is it connected?" button
/// kept its place; the two actions that change the connection moved in here.
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
    return Semantics(
      label: 'More actions for $hostLabel',
      button: true,
      child: PopupMenuButton<_HostMenuAction>(
        tooltip: 'More actions for $hostLabel',
        onSelected: (action) => switch (action) {
          _HostMenuAction.rename => onRename(),
          _HostMenuAction.forget => onForget(),
        },
        itemBuilder: (context) => [
          const PopupMenuItem(
            value: _HostMenuAction.rename,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.edit_outlined),
              title: Text('Rename connection'),
            ),
          ),
          const PopupMenuDivider(),
          PopupMenuItem(
            value: _HostMenuAction.forget,
            child: ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.link_off, color: destructive),
              title: const Text('Forget host'),
            ),
          ),
        ],
      ),
    );
  }
}
