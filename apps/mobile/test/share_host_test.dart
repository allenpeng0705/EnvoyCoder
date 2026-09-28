import 'package:envoydev_mobile/models/host.dart';
import 'package:envoydev_mobile/services/share_host.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('link method shares a rebuildable pairing URI', () {
    final host = CoderHost(
      id: 'owner::10.0.0.5:4770',
      label: 'Studio',
      endpoint: '10.0.0.5:4770',
      ownerId: 'envoy:owner:x',
      app: 'EnvoyDev',
      token: 'secret99',
      lanWsUrl: 'ws://10.0.0.5:4770/ws',
      joinMethod: HostJoinMethod.link,
    );
    final text = sharePayloadFor(host);
    expect(text, startsWith('envoy://pair?'));
    expect(text, contains('token=secret99'));
    expect(text, contains('10.0.0.5'));
  });

  test('direct method shares only host:port + token', () {
    final host = CoderHost(
      id: 'tcp::10.0.0.5:4770',
      label: 'Studio',
      endpoint: '10.0.0.5:4770',
      ownerId: '',
      app: 'EnvoyDev',
      token: 'MyPhone99',
      joinMethod: HostJoinMethod.direct,
    );
    expect(sharePayloadFor(host), 'endpoint: 10.0.0.5:4770\ntoken: MyPhone99');
  });

  test('ssh method shares hop fields, never invents a pairing link', () {
    final host = CoderHost(
      id: 'ssh::bastion::127.0.0.1:4770',
      label: 'Home',
      endpoint: '127.0.0.1:4770',
      ownerId: '',
      app: 'EnvoyDev',
      token: 'sshtoken1',
      joinMethod: HostJoinMethod.ssh,
      ssh: const SshHop(host: 'bastion', port: 22, user: 'me', password: 'pw'),
    );
    final text = sharePayloadFor(host);
    expect(text, contains('sshHost: bastion'));
    expect(text, contains('sshUser: me'));
    expect(text, contains('daemon: 127.0.0.1:4770'));
    expect(text, contains('token: sshtoken1'));
    expect(text, isNot(contains('sshPassword')));
    expect(text, isNot(contains('pw')));
    expect(text, isNot(contains('envoy://pair')));
  });

  test('legacy rows without joinMethod infer from id / ssh', () {
    final direct = CoderHost(
      id: 'tcp::1.2.3.4:4770',
      label: 'x',
      endpoint: '1.2.3.4:4770',
      ownerId: '',
      app: 'EnvoyDev',
      token: 'tokentok1',
    );
    expect(direct.effectiveJoinMethod, HostJoinMethod.direct);
    expect(sharePayloadFor(direct), startsWith('endpoint:'));
  });
}
