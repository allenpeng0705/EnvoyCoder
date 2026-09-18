/// Project rail projection — Dart twin of `@envoydev/task-model`'s `groupByProject` / `filterRows`.
///
/// Same rules as the desktop sidebar: projects stay put (newest `addedAt` first); tasks pin then
/// recency inside a project; search matches title, cwd, project label and path.
library;

class ProjectInfo {
  const ProjectInfo({
    required this.id,
    required this.path,
    required this.label,
    required this.hostId,
    required this.addedAt,
    this.defaultHarness,
  });

  final String id;
  final String path;
  final String label;
  final String hostId;
  final String addedAt;
  final String? defaultHarness;

  factory ProjectInfo.fromJson(Map<String, dynamic> json) {
    final defaults = json['defaults'];
    return ProjectInfo(
      id: (json['id'] as String?) ?? '',
      path: (json['path'] as String?) ?? '',
      label: (json['label'] as String?) ?? 'project',
      hostId: (json['hostId'] as String?) ?? 'local',
      addedAt: (json['addedAt'] as String?) ?? DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
      defaultHarness: defaults is Map ? defaults['harness'] as String? : null,
    );
  }
}

class TaskInfo {
  const TaskInfo({
    required this.id,
    required this.projectId,
    required this.title,
    required this.status,
    required this.updatedAt,
    this.cwd,
    this.runId,
    this.harness,
    this.pinned = false,
    this.archivedAt,
    this.hostId,
  });

  final String id;
  final String projectId;
  final String title;
  final String status;
  final String updatedAt;
  final String? cwd;
  final String? runId;
  final String? harness;
  final bool pinned;
  final String? archivedAt;
  final String? hostId;

  factory TaskInfo.fromJson(Map<String, dynamic> json) {
    return TaskInfo(
      id: (json['id'] as String?) ?? '',
      projectId: (json['projectId'] as String?) ?? '',
      title: ((json['title'] as String?) ?? '').trim().isEmpty
          ? 'Untitled task'
          : (json['title'] as String).trim(),
      status: (json['status'] as String?) ?? '',
      updatedAt: (json['updatedAt'] as String?) ?? '',
      cwd: json['cwd'] as String?,
      runId: json['runId'] as String?,
      harness: json['harness'] as String?,
      pinned: json['pinned'] == true,
      archivedAt: json['archivedAt'] as String?,
      hostId: json['hostId'] as String?,
    );
  }
}

class ProjectGroup {
  const ProjectGroup({
    required this.project,
    required this.tasks,
    required this.needsAttention,
  });

  final ProjectInfo project;
  final List<TaskInfo> tasks;
  final int needsAttention;
}

/// Group tasks under projects in the order the desktop sidebar uses.
List<ProjectGroup> groupByProject({
  required List<ProjectInfo> projects,
  required List<TaskInfo> tasks,
  bool includeArchived = false,
}) {
  final visible = tasks.where((t) => includeArchived || t.archivedAt == null).toList();
  final byProject = <String, List<TaskInfo>>{};
  for (final task in visible) {
    byProject.putIfAbsent(task.projectId, () => []).add(task);
  }

  final groups = <ProjectGroup>[];
  for (final project in projects) {
    final rows = _sortTasks(byProject[project.id] ?? const []);
    groups.add(
      ProjectGroup(
        project: project,
        tasks: rows,
        needsAttention: rows.where((t) => _needsHuman(t.status)).length,
      ),
    );
  }

  final known = projects.map((p) => p.id).toSet();
  for (final entry in byProject.entries) {
    if (known.contains(entry.key)) continue;
    final orphanTasks = _sortTasks(entry.value);
    final first = orphanTasks.isNotEmpty ? orphanTasks.first : null;
    groups.add(
      ProjectGroup(
        project: ProjectInfo(
          id: entry.key,
          path: first?.cwd ?? entry.key,
          label: 'Unknown project',
          hostId: first?.hostId ?? 'local',
          addedAt: DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
        ),
        tasks: orphanTasks,
        needsAttention: orphanTasks.where((t) => _needsHuman(t.status)).length,
      ),
    );
  }

  groups.sort((a, b) {
    final added = DateTime.tryParse(b.project.addedAt)?.millisecondsSinceEpoch ?? 0;
    final other = DateTime.tryParse(a.project.addedAt)?.millisecondsSinceEpoch ?? 0;
    final delta = added - other;
    if (delta != 0) return delta;
    return a.project.label.toLowerCase().compareTo(b.project.label.toLowerCase());
  });
  return groups;
}

/// Filter groups by a free-text query (title, cwd, project label/path).
List<ProjectGroup> filterProjectGroups(List<ProjectGroup> groups, String query) {
  final text = query.trim().toLowerCase();
  if (text.isEmpty) return groups;

  bool projectHit(ProjectInfo project) =>
      project.label.toLowerCase().contains(text) || project.path.toLowerCase().contains(text);

  return groups
      .map((group) {
        if (projectHit(group.project)) return group;
        final tasks = group.tasks.where((task) {
          return task.title.toLowerCase().contains(text) ||
              (task.cwd?.toLowerCase().contains(text) ?? false) ||
              group.project.label.toLowerCase().contains(text) ||
              group.project.path.toLowerCase().contains(text);
        }).toList();
        return ProjectGroup(
          project: group.project,
          tasks: tasks,
          needsAttention: tasks.where((t) => _needsHuman(t.status)).length,
        );
      })
      .where((group) => group.tasks.isNotEmpty || projectHit(group.project))
      .toList();
}

int attentionBadge(List<TaskInfo> tasks) =>
    tasks.where((t) => t.status == 'needs-attention' || t.status == 'failed').length;

String statusLabel(String status) => switch (status) {
      'needs-attention' => 'Needs your answer',
      'running' => 'Working',
      'queued' => 'Queued',
      'done' => 'Done',
      'failed' => 'Failed',
      'cancelled' => 'Stopped',
      'idle' => 'Idle',
      _ => status.isEmpty ? 'Unknown' : status,
    };

bool _needsHuman(String status) => status == 'needs-attention';

List<TaskInfo> _sortTasks(List<TaskInfo> tasks) {
  final copy = List<TaskInfo>.from(tasks);
  copy.sort((a, b) {
    if (a.pinned != b.pinned) return a.pinned ? -1 : 1;
    final aAt = DateTime.tryParse(a.updatedAt)?.millisecondsSinceEpoch ?? 0;
    final bAt = DateTime.tryParse(b.updatedAt)?.millisecondsSinceEpoch ?? 0;
    return bAt - aAt;
  });
  return copy;
}
