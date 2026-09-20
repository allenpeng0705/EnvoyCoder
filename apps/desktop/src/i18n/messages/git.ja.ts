/**
 * The **git** sentences of the Japanese catalogue, one namespace of it.
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
  "error.gitNothingStaged": "ステージされた変更がないため、コミットするものがありません。まずファイルをステージしてください（すべてでも可）。",
  "error.gitMergeConflict": "{branch} は自動でマージできません。次のファイルが競合しています: {files}。何も変更していません — ブランチと作業ツリーは元のままです。",
  "error.gitPullDiverged": "手元のブランチとリモートのブランチが両方変わっているため、pull では統合できません。マージするか、自分のブランチを push してください。",
  "error.gitNothingToStash": "しまっておく変更がありません。このフォルダに未コミットの変更があるファイルはありません。",
  "error.gitStashDirty": "スタッシュを戻すには作業ツリーがきれいである必要があります。先にこのフォルダの変更をコミットするかスタッシュしてください。",
  "error.gitStashConflict": "このスタッシュはきれいに戻せません。次のファイルが競合しています: {files}。何も変更されておらず、スタッシュはそのまま残っています。",
  "git.stash.title": "スタッシュ",
  "git.stash.cta": "スタッシュ",
  "git.stash.done": "しまっておきました。",
  "git.stash.pop": "戻す",
  "git.stash.drop": "破棄",
  "git.stash.confirm": "このスタッシュを破棄しますか？",
  "git.stash.empty": "スタッシュはありません。",
  "git.merge.into": "{branch} を {current} にマージ",
  "git.merge.cta": "マージ",
  "git.merge.done": "{branch} を {into} にマージしました。",
  "git.fetch.nothing": "\u53d6\u5f97\u3057\u307e\u3057\u305f\u3002\u65b0\u3057\u3044\u3082\u306e\u306f\u3042\u308a\u307e\u305b\u3093\u3002",
  "git.pull.nothing": "\u53d6\u308a\u8fbc\u307f\u307e\u3057\u305f\u3002\u3059\u3067\u306b\u6700\u65b0\u3067\u3059\u3002",
  "git.fetch.cta": "フェッチ",
  "git.fetch.done": "取得しました。{summary}",
  "git.pull.cta": "プル",
  "git.pull.done": "取り込みました。{summary}",
  "error.gitCommitEmpty": "コミットにはメッセージが必要です。",
  "error.gitTimedOut": "git が時間内に終わらなかったため、EnvoyDev が停止しました。リポジトリが非常に大きいか、git が何かを待っている可能性があります。",
  "git.branches.title": "ブランチ",
  "git.branches.aria": "{project} のブランチ",
  "git.branches.detachedChip": "ブランチなし",
  "git.branches.detached": "このリポジトリは HEAD が切り離されているため、現在のブランチはありません。",
  "git.branches.empty": "このリポジトリにはまだブランチがありません。",
  "git.branches.new": "新しいブランチ",
  "git.branches.name": "ブランチ名",
  "git.branches.create": "作成して切り替え",
  "git.branches.switched": "{branch} に切り替えました。",
  "git.branches.created": "{branch} を作成し、切り替えました。",
  "error.gitMissing": "このマシンに git がインストールされていないため、EnvoyDev はこのリポジトリを読めません。git をインストールしてからもう一度お試しください。",
  "error.gitNotARepository": "「{path}」は git リポジトリではありません。ブランチは git が追跡しているフォルダーでのみ使えます。",
  "error.gitBusy": "このプロジェクトでは「{title}」が実行中です。ブランチを切り替える前に終了するか停止してください — エージェントの作業中に checkout すると作業が失われます。",
  "error.gitFailed": "git は実行できませんでした: {detail}",
  "error.gitBranchInvalid": "「{name}」はブランチ名にできません。英数字、ピリオド、ハイフン、スラッシュが使え、先頭をハイフンにはできません。",
  "error.gitBranchTooLong": "ブランチ名は最大 {count} 文字です。",
  "error.gitBranchEmpty": "ブランチには名前が必要です。",
} as const;
