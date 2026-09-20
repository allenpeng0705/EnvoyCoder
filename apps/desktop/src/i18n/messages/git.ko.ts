/**
 * The **git** sentences of the Korean catalogue, one namespace of it.
 *
 * ## Why a namespace has its own file
 *
 * The catalogues reached the family's 800-line hard cap (`scripts/check-module-size.mjs`), and its allowlist
 * records what the fix is: split the key namespaces. Git is the largest coherent one and the one this product
 * keeps growing — S1 through S5 added branches, staging, commit, merge, fetch, pull and stash — so it is the
 * namespace that moved first. The base catalogue spreads it back into place, in the position it held before,
 * because a spread in the middle of the object keeps the file's own order readable.
 *
 * A fragment is a plain `as const` object of the same sentences the base file used to carry: `MessageKey`
 * is still `keyof typeof en`, and `i18n.test.ts` still proves the seven languages agree key for key.
 */

export const git = {
  "error.gitNothingStaged": "스테이지된 변경이 없어 커밋할 것이 없습니다. 먼저 파일을 스테이지하세요(전부라도 됩니다).",
  "error.gitMergeConflict": "{branch}을(를) 자동으로 병합할 수 없습니다. 다음 파일이 충돌합니다: {files}. 아무것도 바뀌지 않았습니다 — 브랜치와 작업 트리는 그대로입니다.",
  "error.gitPullDiverged": "컴퓨터의 브랜치와 원격의 브랜치가 모두 바뀌어 pull로 합칠 수 없습니다. 병합하거나 브랜치를 push하세요.",
  "error.gitNothingToStash": "치워 둘 변경이 없습니다. 이 폴더에서 커밋되지 않은 변경이 있는 파일이 없습니다.",
  "error.gitStashDirty": "스태시를 되돌리려면 작업 트리가 깨끗해야 합니다. 먼저 이 폴더의 변경을 커밋하거나 스태시하세요.",
  "error.gitStashConflict": "이 스태시는 깨끗하게 되돌릴 수 없습니다. 다음 파일이 충돌합니다: {files}. 아무것도 변경되지 않았고 스태시는 그대로 있습니다.",
  "git.stash.title": "스태시",
  "git.stash.cta": "스태시",
  "git.stash.done": "치워 두었습니다.",
  "git.stash.pop": "되돌리기",
  "git.stash.drop": "버리기",
  "git.stash.confirm": "이 스태시를 버릴까요?",
  "git.stash.empty": "치워 둔 것이 없습니다.",
  "git.merge.into": "{branch}을(를) {current}에 병합",
  "git.merge.cta": "병합",
  "git.merge.done": "{branch}을(를) {into}에 병합했습니다.",
  "git.fetch.nothing": "\uac00\uc838\uc654\uc2b5\ub2c8\ub2e4. \uc0c8\ub85c\uc6b4 \uac83\uc740 \uc5c6\uc2b5\ub2c8\ub2e4.",
  "git.pull.nothing": "\ud480\ud588\uc2b5\ub2c8\ub2e4. \uc774\ubbf8 \ucd5c\uc2e0\uc785\ub2c8\ub2e4.",
  "git.fetch.cta": "가져오기",
  "git.fetch.done": "가져왔습니다. {summary}",
  "git.pull.cta": "풀",
  "git.pull.done": "풀했습니다. {summary}",
  "error.gitCommitEmpty": "커밋에는 메시지가 필요합니다.",
  "error.gitTimedOut": "git이 제때 끝나지 않아 EnvoyDev가 중지했습니다. 저장소가 매우 크거나 git이 무언가를 기다리고 있을 수 있습니다.",
  "git.branches.title": "브랜치",
  "git.branches.aria": "{project}의 브랜치",
  "git.branches.detachedChip": "브랜치 없음",
  "git.branches.detached": "이 저장소는 HEAD가 분리되어 있어 현재 브랜치가 없습니다.",
  "git.branches.empty": "이 저장소에는 아직 브랜치가 없습니다.",
  "git.branches.new": "새 브랜치",
  "git.branches.name": "브랜치 이름",
  "git.branches.create": "만들고 전환",
  "git.branches.switched": "{branch}(으)로 전환했습니다.",
  "git.branches.created": "{branch}을(를) 만들고 전환했습니다.",
  "error.gitMissing": "이 컴퓨터에 git이 설치되어 있지 않아 EnvoyDev가 이 저장소를 읽을 수 없습니다. git을 설치한 뒤 다시 시도하세요.",
  "error.gitNotARepository": "\"{path}\"은(는) git 저장소가 아닙니다. 브랜치는 git이 추적하는 폴더에서만 쓸 수 있습니다.",
  "error.gitBusy": "이 프로젝트에서 \"{title}\"이(가) 실행 중입니다. 브랜치를 바꾸기 전에 끝내거나 중지하세요 — 에이전트가 작업하는 중에 checkout하면 작업이 사라집니다.",
  "error.gitFailed": "git이 실행하지 못했습니다: {detail}",
  "error.gitBranchInvalid": "\"{name}\"은(는) 브랜치 이름이 될 수 없습니다. 문자, 숫자, 점, 하이픈, 슬래시를 쓸 수 있고 하이픈으로 시작할 수 없습니다.",
  "error.gitBranchTooLong": "브랜치 이름은 최대 {count}자입니다.",
  "error.gitBranchEmpty": "브랜치에는 이름이 필요합니다.",
} as const;
