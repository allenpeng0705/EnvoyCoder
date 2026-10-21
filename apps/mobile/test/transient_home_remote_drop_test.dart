import 'package:envoydev_mobile/services/host_client.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('homeRemote.disconnected is a transient transport drop', () {
    expect(isTransientHomeRemoteDrop(Exception('homeRemote.disconnected')), isTrue);
    expect(isTransientHomeRemoteDrop(Exception('homeRemote.notConnected')), isTrue);
    expect(isTransientHomeRemoteDrop(Exception('homeRemote.listProjectsTimeout')), isFalse);
    expect(isTransientHomeRemoteDrop(Exception('something else')), isFalse);
  });
}
