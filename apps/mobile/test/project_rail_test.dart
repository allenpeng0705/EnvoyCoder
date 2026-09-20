import 'package:envoydev_mobile/models/project_rail.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('groupByProject', () {
    test('keeps newest project first and ignores attention bubbling', () {
      const older = ProjectInfo(
        id: 'p-old',
        path: '/repo/old',
        label: 'old',
        hostId: 'local',
        addedAt: '2026-09-01T00:00:00.000Z',
      );
      const newer = ProjectInfo(
        id: 'p-new',
        path: '/repo/new',
        label: 'new',
        hostId: 'local',
        addedAt: '2026-09-10T00:00:00.000Z',
      );
      final groups = groupByProject(
        projects: [older, newer],
        tasks: [
          TaskInfo(
            id: 't1',
            projectId: older.id,
            title: 'needs you',
            status: 'needs-attention',
            updatedAt: '2026-09-13T12:00:00.000Z',
          ),
          TaskInfo(
            id: 't2',
            projectId: newer.id,
            title: 'idle',
            status: 'idle',
            updatedAt: '2026-09-01T00:00:00.000Z',
          ),
        ],
      );
      expect(groups.map((g) => g.project.label), ['new', 'old']);
    });

    test('pins then orders by recency inside a project', () {
      const project = ProjectInfo(
        id: 'p',
        path: '/repo',
        label: 'repo',
        hostId: 'local',
        addedAt: '2026-09-01T00:00:00.000Z',
      );
      final groups = groupByProject(
        projects: [project],
        tasks: [
          const TaskInfo(
            id: 'old',
            projectId: 'p',
            title: 'old',
            status: 'idle',
            updatedAt: '2026-09-01T00:00:00.000Z',
          ),
          const TaskInfo(
            id: 'new',
            projectId: 'p',
            title: 'new',
            status: 'idle',
            updatedAt: '2026-09-13T00:00:00.000Z',
          ),
          const TaskInfo(
            id: 'pinned',
            projectId: 'p',
            title: 'pinned',
            status: 'idle',
            updatedAt: '2026-08-01T00:00:00.000Z',
            pinned: true,
          ),
        ],
      );
      expect(groups.single.tasks.map((t) => t.id), ['pinned', 'new', 'old']);
    });

    test('keeps empty projects visible', () {
      const project = ProjectInfo(
        id: 'p',
        path: '/repo',
        label: 'repo',
        hostId: 'local',
        addedAt: '2026-09-01T00:00:00.000Z',
      );
      final groups = groupByProject(projects: [project], tasks: []);
      expect(groups, hasLength(1));
      expect(groups.single.tasks, isEmpty);
    });
  });

  group('filterProjectGroups', () {
    test('keeps a project when the query hits its label, even with no tasks', () {
      const empty = ProjectInfo(
        id: 'archive',
        path: '/repo/archive',
        label: 'archive',
        hostId: 'local',
        addedAt: '2026-09-01T00:00:00.000Z',
      );
      const other = ProjectInfo(
        id: 'other',
        path: '/repo/other',
        label: 'other',
        hostId: 'local',
        addedAt: '2026-09-02T00:00:00.000Z',
      );
      final groups = groupByProject(
        projects: [empty, other],
        tasks: [
          TaskInfo(
            id: 't',
            projectId: other.id,
            title: 'work',
            status: 'idle',
            updatedAt: '2026-09-02T00:00:00.000Z',
          ),
        ],
      );
      final filtered = filterProjectGroups(groups, 'archive');
      expect(filtered, hasLength(1));
      expect(filtered.single.project.label, 'archive');
    });

    test('matches task title', () {
      const project = ProjectInfo(
        id: 'p',
        path: '/repo',
        label: 'payments',
        hostId: 'local',
        addedAt: '2026-09-01T00:00:00.000Z',
      );
      final groups = groupByProject(
        projects: [project],
        tasks: [
          const TaskInfo(
            id: 't',
            projectId: 'p',
            title: 'Idempotency keys',
            status: 'idle',
            updatedAt: '2026-09-01T00:00:00.000Z',
            cwd: '/repo',
          ),
        ],
      );
      expect(filterProjectGroups(groups, 'idempotency').single.tasks.single.id, 't');
      expect(filterProjectGroups(groups, 'nothing'), isEmpty);
    });
  });
}
