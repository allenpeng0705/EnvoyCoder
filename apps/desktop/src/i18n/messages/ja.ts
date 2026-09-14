/**
 * ja — the catalogue every string in this window is rendered from.
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

export const ja: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "このコンピューター",
  "app.rail.show": "プロジェクトを表示",
  "app.rail.hide": "プロジェクトを隠す",
  "app.rail.toggle": "プロジェクトバーの表示を切り替え",
  "app.windows.count": "{count} 個のウィンドウ",
  "app.windows.title": "このサービスはすべての EnvoyCoder ウィンドウに接続を提供します",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "起動中…",
  "connection.unreachable": "サービスに到達できません",
  "connection.none": "未接続",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "閉じる",

  /* ── the rail ── */
  "sidebar.aria": "プロジェクトとタスク",
  "sidebar.add": "+ プロジェクトを追加",
  "sidebar.add.title": "作業するディレクトリをプロジェクトとして登録",
  "sidebar.command.title": "コマンドパレットを開く",
  "sidebar.search.placeholder": "タスク、リポジトリ、パスを検索",
  "sidebar.search.aria": "タスク、リポジトリ、パスを検索",
  "sidebar.view.groupBy": "プロジェクトごとにまとめる",
  "sidebar.view.flat": "新しい順のフラットな一覧",
  "sidebar.view.group": "まとめる",
  "sidebar.view.list": "一覧",
  "sidebar.attention.one": "1 件のタスクがあなたを待っています",
  "sidebar.attention.many": "{count} 件のタスクがあなたを待っています",
  "sidebar.empty.title": "まだプロジェクトがありません",
  "sidebar.empty.body": "作業するディレクトリを追加してください。そこで開始したタスクがここに並び、プロジェクトはどのエージェントを使うべきかを覚えています。",
  "sidebar.empty.noMatch": "「{query}」に一致するものはありません。",
  "sidebar.section.tasks": "タスク",
  "sidebar.project.attention": "あなたを待っているタスク",
  "sidebar.project.agent": "このプロジェクトで新しいタスクを始めるエージェント",
  "sidebar.project.settings": "プロジェクト設定",
  "sidebar.project.settings.aria": "{project} のプロジェクト設定",
  "sidebar.project.newTask": "+ 新規",
  "sidebar.project.newTask.title": "{project} でタスクを開始",
  "sidebar.tasks.empty": "ここにはまだタスクがありません。",
  "sidebar.footer.add": "プロジェクトを追加",
  "sidebar.footer.host": "ホスト: {host}",
  "sidebar.footer.import": "セッションを読み込む（未実装）",
  "sidebar.footer.import.title": "他のエージェントの履歴からセッションを取り込む機能はまだありません — エージェントごとの読み取りが必要です。",
  "sidebar.footer.help": "ヘルプとサポート（未実装）",
  "sidebar.footer.help.title": "ヘルプ画面はまだありません。ショートカットの登録表はありますが、ヘルプシートはこれからです。",
  "sidebar.footer.settings": "設定",

  /* ── the command palette ── */
  "palette.title": "コマンドパレット",
  "palette.placeholder": "コマンドを入力",
  "palette.search.aria": "コマンドを検索",
  "palette.value": "値",
  "palette.selected": "選択中",
  "palette.empty": "一致するものはありません。",
  "palette.group.projects": "プロジェクト",
  "palette.group.tasks": "タスク",
  "palette.group.machine": "このコンピューター",
  "palette.addProject.title": "プロジェクトを追加…",
  "palette.addProject.subtitle": "作業するディレクトリを登録します",
  "palette.addProject.pickPrompt": "プロジェクトのフォルダーを選択",
  "palette.addProject.noFolder": "フォルダーが選ばれなかったため、何も追加されませんでした。",
  "palette.newTask.title": "{project} の新しいタスク",
  "palette.newTask.label": "エージェントに何をさせますか？",
  "palette.newTask.placeholder": "タスクを説明してください",
  "palette.openTask.subtitle": "このタスクを開く",
  "palette.pairPhone.title": "スマートフォンをペアリング",
  "palette.pairPhone.subtitle": "モバイルアプリが読み取れるコードを表示",
  "palette.pairPhone.notYet": "スマートフォンのペアリングはモバイルのマイルストーンで登場します。サービスにはまだセッションストアがないため、意図的にリモートクライアントを拒否しています。",
  "palette.toggleRail.title": "プロジェクトバーの表示を切り替え",
  "palette.settings.title": "設定を開く",
  "palette.settings.subtitle": "新しいタスクの既定値と、承認が必要な操作",
  "palette.noPicker": "このウィンドウには問い合わせる shell がないので、代わりにフォルダーのパスを貼り付けてください。",
  "palette.pickerFailed": "フォルダー選択を開けませんでした: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder はサービスに接続できません",
  "work.offline.body": "サービスはタスクを実行するプロセスで、応答していません。アプリと一緒に起動するので、たいていは少し待てば直ります。",
  "work.loading": "プロジェクトを読み込み中…",
  "work.noTask.title": "開いているタスクがありません",
  "work.noTask.body": "左の一覧からタスクを選ぶか、プロジェクトで新しいタスクを開始してください。エージェントはこのコンピューターで動き、メッシュに接続していれば他のコンピューターでも動きます。",
  "work.noProjects.title": "まだプロジェクトがありません",
  "work.noProjects.body": "作業するディレクトリを追加すると、EnvoyCoder はそこでエージェントを動かせます。",
  "work.noTask.action": "タスクを開始",
  "work.noProjects.action": "プロジェクトを追加",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "タスク {title}",
  "task.meta.agent": "このタスクを実行しているエージェント",
  "task.meta.cwd": "作業ディレクトリ: {path}",
  "task.meta.host": "このタスクを実行するコンピューター",
  "task.cancel": "停止",
  "task.cancel.title": "エージェントに停止を求める",
  "task.transcript.gap": "このタスクの履歴の一部が届いていません。ここにあるものは順序どおりです。再読み込みすると再度問い合わせます。",
  "task.transcript.empty.title": "まだ何もありません",
  "task.transcript.empty.body": "何かを頼むと、エージェントは {cwd} で作業します。ツール呼び出し、承認、差分は起きた順にここに現れます。",
  "task.you": "あなた",
  "task.delivered.steered": "ターンに割り込みました",
  "task.delivered.queued": "ターンを待っています",
  "task.thought.summary": "どのように考えたか",
  "task.approval.aria": "エージェントがあなたの回答を待っています",
  "task.approval.answered": "回答済み",
  "task.approval.answeredWith": "回答済み: {option}",
  "task.composer.aria": "エージェントにメッセージを送る",
  "task.composer.placeholder.approval": "送信する前に、上の要求に答えてください",
  "task.composer.placeholder.running": "追加の指示を書く — 「キュー」はこのターンを待ち、「割り込み」は途中で入ります",
  "task.composer.placeholder.idle": "タスクを説明してください",
  "task.composer.queue": "キュー",
  "task.composer.steer": "割り込み",
  "task.composer.mode.aria": "メッセージの届け方",
  "task.composer.mode.title": "「キュー」は現在のターンを待ち、「割り込み」はそこに入ります",
  "task.composer.send": "送信",
  "task.composer.start": "開始",
  "task.composer.submit.blocked": "先に上の要求に答えてください",

  /* ── a status, in the words a user reads ── */
  "status.queued": "開始待ち",
  "status.running": "実行中",
  "status.needsAttention": "あなたの回答待ち",
  "status.idle": "待機",
  "status.done": "完了",
  "status.failed": "エラーで停止",
  "status.cancelled": "停止",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "完了しました。",
  "run.end.cancelled": "停止しました。",
  "run.end.failed": "終わる前に停止しました。",
  "run.end.other": "終了しました。",
  "run.diff.one": "1 個のファイルを変更しました。",
  "run.diff.many": "{count} 個のファイルを変更しました。",
  "run.context": "コンテキストが {percent}% 埋まっています。",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "メッシュ接続済み — {count} 台に到達できます",
  "mesh.attached.none": "メッシュ接続済み — 到達できる他のマシンはまだありません",
  "mesh.noNode": "EnvoyMesh が動いていません — タスクはこのコンピューターにとどまります",
  "mesh.refused": "EnvoyMesh が EnvoyCoder にセッションを許可しませんでした — タスクはこのコンピューターにとどまります",
  "mesh.peers": "{count} ピア",
  "mesh.scope.title": "セッションスコープ {scope}",
  "mesh.agentsHere": "エージェントはこのコンピューターで動きます",

  /* ── settings ── */
  "settings.title": "設定",
  "settings.close": "閉じる",
  "settings.stateDir": "データ: {path}",
  "settings.noDaemon": "サービスなし",
  "settings.daemon": "サービス {version}",
  "settings.daemon.title": "このウィンドウが接続しているサービス",
  "settings.language.title": "言語",
  "settings.language.detail": "このウィンドウの言語です。ラベル、通知、エラー、そしてサービスから返ってくるエラーまで含みます。このコンピューターの設定として保存されるので、他のウィンドウやスマートフォンにも引き継がれます。",
  "settings.language.aria": "言語",
  "settings.language.system": "このコンピューターに合わせる",
  "settings.defaultHarness.title": "新しいタスクを始めるエージェント",
  "settings.defaultHarness.detail": "プロジェクト側で上書きできます。上書きしない場合の答えがこれです。",
  "settings.needsInstalling": "（要インストール）",
  "settings.approvals.title": "破壊的な操作の前に確認する",
  "settings.approvals.detail": "エージェントはファイルを上書きせず、止まってあなたを待ちます。これを切ると、タスクは確認なしに作業ツリーを変更できます。",
  "settings.remoteRuns.title": "このコンピューターのエージェントを他のコンピューターと共有する",
  "settings.remoteRuns.detail": "既定ではオフです。オンにすると、あなたの別のコンピューターからのタスクが、あなたのディレクトリでここで実行できます。",
  "settings.transcripts.title": "タスク終了後も記録を残す",
  "settings.transcripts.detail": "エージェントが何をしたかの記録を、このコンピューターに残します。切ると容量を節約できますが、後から「何を変えたのか」に答えられなくなります。",
  "settings.agents.heading": "このコンピューターのエージェント",
  "settings.agents.note": "各エージェントに実際にできることが、EnvoyCoder の提供内容を決めます。許可を求められないエージェントには、無視される承認ダイアログを出しません。",
  "settings.agents.empty": "エージェント一覧はまだ届いていません。",
  "settings.agent.notInstalled": "未インストール",
  "settings.agent.unknown": "不明",
  "settings.agent.ready": "準備完了",
  "settings.agent.noApprovals": "承認なし",
  "settings.agent.noApprovals.title": "このエージェントは行動前に決して確認しません",
  "settings.agent.noCancel": "中止できません",
  "settings.agent.noCancel.title": "このエージェントを止める唯一の方法は、そのプロセスを終了することです",
  "settings.notes.heading": "知っておくとよいこと",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path} はこのコンピューター上のディレクトリではありません。存在するフォルダーを選んでください — EnvoyCoder はそこでエージェントを動かすので、パスは実在する必要があります。",
  "error.createTask.notDirectory": "{path} はこのコンピューター上のディレクトリではないため、エージェントを動かす場所がありません。これは「{title}」の作業ディレクトリでした。",
  "error.projectNotFound": "このコンピューターに「{id}」というプロジェクトはありません。別のウィンドウで削除された可能性があります。",
  "error.taskNotFound": "このコンピューターに「{id}」というタスクはありません。別のウィンドウで削除された可能性があります。",
  "error.runNotFound": "「{runId}」という実行はありません。その後再起動したサービスが開始した可能性があります。",
  "error.taskForRunMissing": "「{taskId}」というタスクがないため、エージェントを動かす場所がありません。",
  "error.taskAlreadyRunning": "「{task}」はすでに実行中です。代わりにメッセージを送ってください — 同じディレクトリで 2 つ目のエージェントを起動すると、2 つが同じファイルを編集する事態になります。",
  "error.runFinished": "その実行はすでに終わっているので、送る先がありません。代わりに新しいタスクを開始してください。",
  "error.approvalPending": "エージェントは続ける前に回答を待っています。先にそれに答えてください — 今送ったメッセージはその後ろで待つことになります。",
  "error.noRunRuntime": "このサービスはエージェントランタイムなしで起動されたため、タスクを実行できません。",
  "error.harnessMissing": "{harness} はこのコンピューターにインストールされていません。インストールしてから、タスクをもう一度開始してください。",
  "error.harnessUnsupported": "{harness} は EnvoyCoder がまだ扱えないプロトコルで話します（このアダプターは ACP エージェントのみを扱います）。現在は Envoy Harness と DeepSeek Harness が動作します。{harness} には専用のアダプターが必要です。",
  "error.notConnected": "EnvoyCoder はまだサービスに接続していません。",
  "error.notConnectedChange": "EnvoyCoder がサービスに接続していないため、その変更は保存されませんでした。",
  "error.connectionClosed": "接続が閉じられました。",
  "error.daemonClosedConnection": "サービスが接続を閉じました。",
  "error.notOurDaemon.product": "サービスのポートで何かが応答していますが、それは「{product}」と名乗っています。EnvoyCoder はそこに接続しませんでした。",
  "error.notOurDaemon.instance": "ポート {port} のサービスは、このウィンドウが起動時に想定したものではありません。別の EnvoyCoder サービスに入れ替わった可能性があります — ウィンドウを開き直してください。",
  "error.shellEndpointFailed": "EnvoyCoder のウィンドウは shell にサービスの場所を尋ねられませんでした。デスクトップアプリを再ビルドしてください（shell の権限一覧が古くなっています）。",
  "error.shellEndpointMissing": "EnvoyCoder の shell がサービスの場所を答えませんでした。これがないと、このウィンドウは接続できません。",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder は {name} を読めなかったため、{movedTo} に退避し、その一覧を空の状態で始めました。（{reason}）",
  "note.quarantined.left": "EnvoyCoder は {name} を読めず、退避もできなかったため、そのまま残して一覧を空の状態で始めました。（{reason}）",
  "note.skipped": "{file}: {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "エージェントに「{tool}」の実行を許可しますか？",
  "approval.question.generic": "エージェントの続行を許可しますか？",
  "approval.detail": "この手順の前で止まっており、あなたが答えるまで続けません。この 1 件に答えることは、他の何かを許可することにはなりません。",
};
