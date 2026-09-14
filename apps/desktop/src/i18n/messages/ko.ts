/**
 * ko — the catalogue every string in this window is rendered from.
 *
 * ## These are unreviewed machine translations
 *
 * Written by a model against the English source, not by a native speaker, and **not yet reviewed by
 * one**. They are good enough to ship a coherently translated window — which is the point: a German
 * user must never read an English refusal from the daemon — but they are not good enough to promise
 * without a check. Before a release, have a native speaker read at least:
 *
 *   * the **approval and permission wording** (`approval.*`, `task.approval.*`, `settings.approvals.*`,
 *     `settings.agent.*`). These are the sentences a user answers to grant an agent the right to
 *     change their files; a wording that is merely awkward everywhere else is a *safety* problem here.
 *   * the **error sentences** (`error.*`), which are read when something has already gone wrong and
 *     the user is least able to work out what an odd phrase meant.
 *
 * ## What is deliberately not translated
 *
 * Agent names and their install hints (`Claude Code`, `npm install -g …`), the mesh's own status
 * vocabulary, and the palette's search keywords: product names, command lines and typed synonyms.
 *
 * ## Form
 *
 * The same keys, in the same order, as `en.ts` — checked by `apps/desktop/test/i18n.test.ts`, which
 * also fails a translation that loses or invents a `{placeholder}`.
 */

import type { Catalogue } from "../translate.js";

export const ko: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "이 컴퓨터",
  "app.rail.show": "프로젝트 표시",
  "app.rail.hide": "프로젝트 숨기기",
  "app.rail.toggle": "프로젝트 레일 표시 전환",
  "app.windows.count": "창 {count}개",
  "app.windows.title": "이 서비스는 모든 EnvoyCoder 창에 연결을 제공합니다",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "시작 중…",
  "connection.unreachable": "서비스에 연결할 수 없음",
  "connection.none": "연결되지 않음",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "닫기",

  /* ── the rail ── */
  "sidebar.aria": "프로젝트와 작업",
  "sidebar.add": "+ 프로젝트 추가",
  "sidebar.add.title": "작업하는 디렉터리를 프로젝트로 등록",
  "sidebar.command.title": "명령 팔레트 열기",
  "sidebar.search.placeholder": "작업, 저장소, 경로 검색",
  "sidebar.search.aria": "작업, 저장소 및 경로 검색",
  "sidebar.view.groupBy": "프로젝트별로 묶기",
  "sidebar.view.flat": "최신 순 단일 목록",
  "sidebar.view.group": "묶기",
  "sidebar.view.list": "목록",
  "sidebar.attention.one": "작업 1개가 당신을 기다립니다",
  "sidebar.attention.many": "작업 {count}개가 당신을 기다립니다",
  "sidebar.empty.title": "아직 프로젝트가 없습니다",
  "sidebar.empty.body": "작업하는 디렉터리를 추가하세요. 그 안에서 시작한 작업이 여기에 나타나고, 프로젝트는 어떤 에이전트를 써야 하는지 기억합니다.",
  "sidebar.empty.noMatch": "“{query}”와 일치하는 것이 없습니다.",
  "sidebar.empty.cannotLoadTitle": "프로젝트를 읽을 수 없습니다",
  "sidebar.empty.cannotLoadBody": "이 목록은 비어 있는 것이 아니라 알 수 없는 상태입니다 — EnvoyCoder가 데몬에 물어볼 수 없었습니다.",
  "sidebar.section.tasks": "작업",
  "sidebar.project.attention": "당신을 기다리는 작업",
  "sidebar.project.agent": "이 프로젝트의 새 작업이 시작하는 에이전트",
  "sidebar.project.settings": "프로젝트 설정",
  "sidebar.project.settings.aria": "{project} 프로젝트 설정",
  "sidebar.project.newTask": "+ 새로 만들기",
  "sidebar.project.newTask.title": "{project}에서 작업 시작",
  "sidebar.tasks.empty": "아직 여기에 작업이 없습니다.",
  "sidebar.footer.add": "프로젝트 추가",
  "sidebar.footer.host": "호스트: {host}",
  "sidebar.footer.import": "세션 가져오기(아직 구현되지 않음)",
  "sidebar.footer.import.title": "다른 에이전트의 기록에서 세션을 가져오는 기능은 아직 없습니다 — 에이전트마다 읽는 코드가 필요합니다.",
  "sidebar.footer.help": "도움말 및 지원(아직 구현되지 않음)",
  "sidebar.footer.help.title": "도움말 화면은 아직 없습니다. 단축키 목록은 있고 도움말 시트는 없습니다.",
  "sidebar.footer.settings": "설정",

  /* ── the command palette ── */
  "palette.title": "명령 팔레트",
  "palette.placeholder": "명령 입력",
  "palette.search.aria": "명령 검색",
  "palette.value": "값",
  "palette.selected": "선택됨",
  "palette.empty": "일치하는 것이 없습니다.",
  "palette.group.projects": "프로젝트",
  "palette.group.tasks": "작업",
  "palette.group.machine": "이 컴퓨터",
  "palette.addProject.title": "프로젝트 추가…",
  "palette.addProject.subtitle": "작업하는 디렉터리를 등록합니다",
  "palette.addProject.pickPrompt": "프로젝트 폴더 선택",
  "palette.addProject.noFolder": "폴더를 선택하지 않아 아무것도 추가되지 않았습니다.",
  "palette.addProject.needs": "어느 폴더입니까? 전체 경로를 붙여넣으세요.",
  "palette.addProject.needsPlaceholder": "/Users/you/work/repo",
  "palette.newTask.title": "{project}의 새 작업",
  "palette.newTask.label": "에이전트가 무엇을 해야 하나요?",
  "palette.newTask.placeholder": "작업을 설명하세요",
  "palette.openTask.subtitle": "이 작업 열기",
  "palette.pairPhone.title": "휴대폰 페어링",
  "palette.pairPhone.subtitle": "모바일 앱이 스캔할 코드를 표시",
  "palette.pairPhone.notYet": "휴대폰 페어링은 모바일 마일스톤에서 제공됩니다. 서비스에 아직 세션 저장소가 없어 원격 클라이언트를 의도적으로 거부합니다.",
  "palette.toggleRail.title": "프로젝트 레일 표시 전환",
  "palette.settings.title": "설정 열기",
  "palette.settings.subtitle": "새 작업의 기본값과 승인이 필요한 항목",
  "palette.noPicker": "이 창에는 물어볼 shell이 없으니 폴더 경로를 대신 붙여넣으세요.",
  "palette.pickerFailed": "폴더 선택기를 열 수 없습니다: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder가 서비스에 연결하지 못합니다",
  "work.offline.body": "서비스는 작업을 실행하는 프로세스인데 응답하지 않습니다. 앱과 함께 시작하므로 보통 잠시 뒤 스스로 해결됩니다.",
  "work.loading": "프로젝트를 불러오는 중…",
  "work.noTask.title": "열린 작업 없음",
  "work.noTask.body": "왼쪽에서 작업을 고르거나 프로젝트에서 새로 시작하세요. 에이전트는 이 컴퓨터에서 실행되고, 메시에 연결되어 있으면 다른 컴퓨터에서도 실행됩니다.",
  "work.noProjects.title": "아직 프로젝트가 없습니다",
  "work.noProjects.body": "작업하는 디렉터리를 추가하면 EnvoyCoder가 그곳에서 에이전트를 실행할 수 있습니다.",
  "work.noTask.action": "작업 시작",
  "work.noProjects.action": "프로젝트 추가",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "작업 {title}",
  "task.meta.agent": "이 작업을 실행하는 에이전트",
  "task.meta.cwd": "작업 디렉터리: {path}",
  "task.meta.host": "이 작업을 실행하는 컴퓨터",
  "task.cancel": "중지",
  "task.cancel.title": "에이전트에게 중지를 요청",
  "task.transcript.gap": "이 작업의 기록 일부가 도착하지 않았습니다. 여기 있는 내용은 순서대로입니다. 새로 고쳐 다시 요청하세요.",
  "task.transcript.empty.title": "아직 아무것도 없습니다",
  "task.transcript.empty.body": "무언가를 요청하면 에이전트가 {cwd}에서 작업합니다. 도구 호출, 승인, 변경 내역이 일어나는 대로 여기에 나타납니다.",
  "task.you": "나",
  "task.delivered.steered": "턴에 끼어들었습니다",
  "task.delivered.queued": "턴을 기다렸습니다",
  "task.thought.summary": "어떻게 생각했는지",
  "task.approval.aria": "에이전트가 당신의 답변을 기다립니다",
  "task.approval.answered": "답변함",
  "task.approval.answeredWith": "답변함: {option}",
  "task.composer.aria": "에이전트에게 메시지 보내기",
  "task.composer.placeholder.approval": "무엇이든 보내기 전에 위 요청에 먼저 답하세요",
  "task.composer.placeholder.running": "이어서 보내기 — ‘대기’는 이 턴을 기다리고 ‘개입’은 턴에 들어갑니다",
  "task.composer.placeholder.idle": "작업을 설명하세요",
  "task.composer.queue": "대기",
  "task.composer.steer": "개입",
  "task.composer.mode.aria": "메시지를 전달하는 방식",
  "task.composer.mode.title": "‘대기’는 진행 중인 턴을 기다리고, ‘개입’은 그 턴에 들어갑니다",
  "task.composer.send": "보내기",
  "task.composer.start": "시작",
  "task.composer.submit.blocked": "먼저 위 요청에 답하세요",

  /* ── a status, in the words a user reads ── */
  "status.queued": "시작 대기",
  "status.running": "실행 중",
  "status.needsAttention": "당신의 답변 필요",
  "status.idle": "대기",
  "status.done": "완료",
  "status.failed": "오류로 중지",
  "status.cancelled": "중지됨",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "완료했습니다.",
  "run.end.cancelled": "중지했습니다.",
  "run.end.failed": "끝나기 전에 중지했습니다.",
  "run.end.other": "종료했습니다.",
  "run.diff.one": "파일 1개를 변경했습니다.",
  "run.diff.many": "파일 {count}개를 변경했습니다.",
  "run.context": "컨텍스트가 {percent}% 찼습니다.",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "메시 연결됨 — 컴퓨터 {count}대에 도달 가능",
  "mesh.attached.none": "메시 연결됨 — 아직 도달할 수 있는 다른 컴퓨터가 없습니다",
  "mesh.noNode": "EnvoyMesh가 실행되지 않았습니다 — 작업은 이 컴퓨터에 남습니다",
  "mesh.refused": "EnvoyMesh가 EnvoyCoder에 세션을 허용하지 않았습니다 — 작업은 이 컴퓨터에 남습니다",
  "mesh.peers": "피어 {count}개",
  "mesh.scope.title": "세션 범위 {scope}",
  "mesh.agentsHere": "에이전트는 이 컴퓨터에서 실행됩니다",

  /* ── settings ── */
  "settings.title": "설정",
  "settings.close": "닫기",
  "settings.stateDir": "데이터 위치 {path}",
  "settings.noDaemon": "서비스 없음",
  "settings.daemon": "서비스 {version}",
  "settings.daemon.title": "이 창이 연결된 서비스",
  "settings.language.title": "언어",
  "settings.language.detail": "이 창의 언어입니다. 모든 라벨, 알림, 오류는 물론 서비스가 돌려보내는 오류까지 포함합니다. 이 컴퓨터의 설정과 함께 저장되므로 다른 창과 휴대폰에도 그대로 따라갑니다.",
  "settings.language.aria": "언어",
  "settings.language.system": "이 컴퓨터 설정을 따름",
  "settings.defaultHarness.title": "새 작업이 시작하는 에이전트",
  "settings.defaultHarness.detail": "프로젝트가 이를 재정의할 수 있습니다. 재정의하지 않을 때 적용되는 값입니다.",
  "settings.needsInstalling": "(설치 필요)",
  "settings.approvals.title": "파괴적인 작업 전에 확인",
  "settings.approvals.detail": "에이전트는 파일을 덮어쓰는 대신 멈추고 당신을 기다립니다. 이 기능을 끄면 작업이 묻지 않고 작업 트리를 바꿀 수 있습니다.",
  "settings.remoteRuns.title": "이 컴퓨터의 에이전트를 다른 컴퓨터와 공유",
  "settings.remoteRuns.detail": "기본값은 꺼짐입니다. 켜면 당신의 다른 컴퓨터에서 온 작업이 여기, 당신의 디렉터리에서 실행될 수 있습니다.",
  "settings.transcripts.title": "작업이 끝난 뒤에도 기록 유지",
  "settings.transcripts.detail": "에이전트가 무엇을 했는지에 대한 기록을 이 컴퓨터에 보관합니다. 끄면 공간을 아끼지만 나중에 “무엇을 바꿨나?”에 답할 수 없게 됩니다.",
  "settings.agents.heading": "이 컴퓨터의 에이전트",
  "settings.agents.note": "각 에이전트가 실제로 할 수 있는 일이 EnvoyCoder가 제공하는 것을 결정합니다. 권한을 물어볼 수 없는 에이전트에게는 무시할 승인 대화상자를 주지 않습니다.",
  "settings.agents.empty": "에이전트 목록이 아직 도착하지 않았습니다.",
  "settings.agent.notInstalled": "설치되지 않음",
  "settings.agent.unknown": "알 수 없음",
  "settings.agent.ready": "준비됨",
  "settings.agent.noApprovals": "승인 없음",
  "settings.agent.noApprovals.title": "이 에이전트는 행동 전에 절대 묻지 않습니다",
  "settings.agent.noCancel": "취소할 수 없음",
  "settings.agent.noCancel.title": "이 에이전트를 멈추는 유일한 방법은 프로세스를 끝내는 것입니다",
  "settings.notes.heading": "알아 둘 만한 것",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path}은(는) 이 컴퓨터의 디렉터리가 아닙니다. 존재하는 폴더를 고르세요 — EnvoyCoder가 그 안에서 에이전트를 실행하므로 경로가 실제로 있어야 합니다.",
  "error.createTask.notDirectory": "{path}은(는) 이 컴퓨터의 디렉터리가 아니어서 에이전트를 실행할 곳이 없습니다. “{title}”의 작업 디렉터리였습니다.",
  "error.projectNotFound": "이 컴퓨터에 “{id}”라는 프로젝트가 없습니다. 다른 창에서 제거되었을 수 있습니다.",
  "error.taskNotFound": "이 컴퓨터에 “{id}”라는 작업이 없습니다. 다른 창에서 제거되었을 수 있습니다.",
  "error.runNotFound": "“{runId}”라는 실행이 없습니다. 그 사이 재시작한 서비스가 시작했을 수 있습니다.",
  "error.taskForRunMissing": "“{taskId}”라는 작업이 없어 에이전트를 실행할 곳이 없습니다.",
  "error.taskAlreadyRunning": "“{task}”이(가) 이미 실행 중입니다. 대신 메시지를 보내세요 — 같은 디렉터리에서 두 번째 에이전트를 시작하면 둘이 같은 파일을 편집하게 됩니다.",
  "error.runFinished": "그 실행은 이미 끝나서 보낼 대상이 없습니다. 대신 새 작업을 시작하세요.",
  "error.approvalPending": "에이전트가 계속하려면 답변을 기다리고 있습니다. 먼저 그것에 답하세요 — 지금 보낸 메시지는 그 뒤에서 기다리게 됩니다.",
  "error.noRunRuntime": "이 서비스는 에이전트 런타임 없이 시작되어 작업을 실행할 수 없습니다.",
  "error.harnessMissing": "{harness}이(가) 이 컴퓨터에 설치되어 있지 않습니다. 설치한 뒤 작업을 다시 시작하세요.",
  "error.harnessUnsupported": "{harness}은(는) EnvoyCoder가 아직 다룰 수 없는 프로토콜을 사용합니다(이 어댑터는 ACP 에이전트만 다룹니다). 현재는 Envoy Harness와 DeepSeek Harness가 동작합니다. {harness}에는 자체 어댑터가 필요합니다.",
  "error.notConnected": "EnvoyCoder가 아직 서비스에 연결되지 않았습니다.",
  "error.notConnectedChange": "EnvoyCoder가 서비스에 연결되어 있지 않아 그 변경은 저장되지 않았습니다.",
  "error.connectionClosed": "연결이 닫혔습니다.",
  "error.daemonClosedConnection": "서비스가 연결을 닫았습니다.",
  "error.daemonTooOld":
    "이 창이 연결된 데몬은 오래된 빌드입니다. {method}을(를) 알지 못합니다. EnvoyCoder를 다시 시작해 창과 데몬을 같은 빌드로 맞춘 뒤 다시 시도하세요.",
  "error.notOurDaemon.product": "서비스 포트에서 무언가 응답하고 있지만 스스로 “{product}”라고 밝힙니다. EnvoyCoder는 거기에 연결하지 않았습니다.",
  "error.notOurDaemon.instance": "포트 {port}의 서비스는 이 창이 시작될 때 기대한 서비스가 아닙니다. 다른 EnvoyCoder 서비스가 그것을 대체했을 수 있습니다 — 창을 다시 여세요.",
  "error.shellEndpointFailed": "EnvoyCoder 창이 shell에 서비스 위치를 물을 수 없었습니다. 데스크톱 앱을 다시 빌드하세요(shell 권한 목록이 오래되었습니다).",
  "error.shellEndpointMissing": "EnvoyCoder의 shell이 서비스 위치를 알려주지 않았습니다. 이것이 없으면 이 창은 연결할 수 없습니다.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder가 {name}을(를) 읽을 수 없어 {movedTo}(으)로 옮기고 그 목록을 빈 상태로 시작했습니다. ({reason})",
  "note.quarantined.left": "EnvoyCoder가 {name}을(를) 읽을 수도, 옮길 수도 없어 그대로 두고 그 목록을 빈 상태로 시작했습니다. ({reason})",
  "note.skipped": "{file}: {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "에이전트가 “{tool}”을(를) 실행하도록 허용할까요?",
  "approval.question.generic": "에이전트가 계속하도록 허용할까요?",
  "approval.detail": "이 단계 전에 멈춰 있고 당신이 답하기 전에는 계속하지 않습니다. 이 한 건에 답하는 것이 다른 무엇도 허용하지 않습니다.",
};
