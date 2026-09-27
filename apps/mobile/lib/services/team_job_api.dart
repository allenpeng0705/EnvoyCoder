/// HostClient wrappers for Team job RPCs (M5 Mobile).
///
/// Thin typed facades over [HostClient.call] so screens do not re-parse
/// `coder.listTeams` / `coder.assessTeamJobReadiness` shapes in three places.
library;

import '../models/team_job.dart';
import 'host_client.dart';

extension TeamJobHostClient on HostClient {
  Future<List<TeamInfo>> listTeams() async {
    final result = await call('coder.listTeams');
    final teams = result['teams'];
    if (teams is! List) return const [];
    return teams
        .whereType<Map>()
        .map((t) => TeamInfo.fromJson(Map<String, dynamic>.from(t)))
        .toList(growable: false);
  }

  Future<JobInfo> createJob({
    required String teamId,
    required String title,
    required String goal,
    String? projectId,
    List<Map<String, dynamic>>? steps,
  }) async {
    final result = await call('coder.createJob', {
      'teamId': teamId,
      'title': title,
      'goal': goal,
      if (projectId != null) 'projectId': projectId,
      if (steps != null) 'steps': steps,
    });
    final job = result['job'];
    if (job is! Map) throw StateError('createJob returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  Future<JobInfo> getJob(String jobId) async {
    final result = await call('coder.getJob', {'jobId': jobId});
    final job = result['job'];
    if (job is! Map) throw StateError('getJob returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  Future<List<JobInfo>> listJobs({String? teamId, String? projectId}) async {
    final result = await call('coder.listJobs', {
      if (teamId != null) 'teamId': teamId,
      if (projectId != null) 'projectId': projectId,
    });
    final jobs = result['jobs'];
    if (jobs is! List) return const [];
    return jobs
        .whereType<Map>()
        .map((j) => JobInfo.fromJson(Map<String, dynamic>.from(j)))
        .toList(growable: false);
  }

  Future<JobInfo> startJob(String jobId) async {
    final result = await call('coder.startJob', {'jobId': jobId});
    final job = result['job'];
    if (job is! Map) throw StateError('startJob returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  Future<JobInfo> pauseJob(String jobId) async {
    final result = await call('coder.pauseJob', {'jobId': jobId});
    final job = result['job'];
    if (job is! Map) throw StateError('pauseJob returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  Future<JobInfo> stopJob(String jobId) async {
    final result = await call('coder.stopJob', {'jobId': jobId});
    final job = result['job'];
    if (job is! Map) throw StateError('stopJob returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  /// Origin daemon Start gate — crew + Git + drafting. Phone must not invent a second reason.
  Future<TeamJobReadiness> assessTeamJobReadiness(String jobId) async {
    final result = await call('coder.assessTeamJobReadiness', {'jobId': jobId});
    return TeamJobReadiness.fromJson(result);
  }

  Future<({bool ok, String? policy})> assessGitContentBus(String path) async {
    final result = await call('coder.assessGitContentBus', {'path': path});
    if (result['ok'] == true) return (ok: true, policy: null);
    return (ok: false, policy: result['policy'] as String?);
  }

  Future<List<JobStepTemplateInfo>> listJobStepTemplates() async {
    final result = await call('coder.listJobStepTemplates');
    final templates = result['templates'];
    if (templates is! List) return const [];
    return templates
        .whereType<Map>()
        .map((t) => JobStepTemplateInfo.fromJson(Map<String, dynamic>.from(t)))
        .toList(growable: false);
  }

  Future<JobInfo> suggestJobSteps({
    required String jobId,
    String? templateId,
    int? parallelCount,
    String? hint,
  }) async {
    final result = await call('coder.suggestJobSteps', {
      'jobId': jobId,
      if (templateId != null) 'templateId': templateId,
      if (parallelCount != null) 'parallelCount': parallelCount,
      if (hint != null) 'hint': hint,
    });
    final job = result['job'];
    if (job is! Map) throw StateError('suggestJobSteps returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  Future<JobInfo> updateJobSteps({
    required String jobId,
    required List<Map<String, dynamic>> steps,
  }) async {
    final result = await call('coder.updateJobSteps', {
      'jobId': jobId,
      'steps': steps,
    });
    final job = result['job'];
    if (job is! Map) throw StateError('updateJobSteps returned no job');
    return JobInfo.fromJson(Map<String, dynamic>.from(job));
  }

  /// Allow / deny a harness approval on a Team job step (§7.7 / §11.7).
  Future<({bool answered, bool alreadyResolved})> answerJobStepApproval({
    required String jobId,
    required String stepId,
    required String requestId,
    required String optionId,
  }) async {
    final result = await call('coder.answerJobStepApproval', {
      'jobId': jobId,
      'stepId': stepId,
      'requestId': requestId,
      'optionId': optionId,
    });
    return (
      answered: result['answered'] == true,
      alreadyResolved: result['alreadyResolved'] == true,
    );
  }
}
