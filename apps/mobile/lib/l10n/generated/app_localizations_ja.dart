// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Japanese (`ja`).
class AppLocalizationsJa extends AppLocalizations {
  AppLocalizationsJa([String locale = 'ja']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => '追加';

  @override
  String get commonCancel => 'キャンセル';

  @override
  String get commonClear => '消去';

  @override
  String get commonConfirm => '確認';

  @override
  String get commonContinue => '続行';

  @override
  String get commonNone => 'なし';

  @override
  String get commonNotSet => '未設定';

  @override
  String get commonOk => '了解';

  @override
  String get commonRemove => '削除';

  @override
  String get commonRename => '名前を変更';

  @override
  String get commonSave => '保存';

  @override
  String get commonSaving => '保存中…';

  @override
  String get connectionStateConnected => '接続済み';

  @override
  String get connectionStateConnecting => '接続中';

  @override
  String get connectionStateReconnecting => '再接続中 — タスクはまだ実行中です';

  @override
  String get connectionStateFailed => '到達できません';

  @override
  String get connectionStateIdle => 'まだ接続していません';

  @override
  String get connectionsTitle => '接続';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 台のコンピューター',
      one: '1 台のコンピューター',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => 'ホストを追加';

  @override
  String get connectionsAddHostSubtitle => 'コードを読み取るか、アドレスを入力します';

  @override
  String get connectionsEmpty => 'まだデスクトップがペアリングされていません。';

  @override
  String get connectionsPairingRefused => 'このパソコンはこのスマートフォンのペアリングを拒否しました';

  @override
  String connectionsPairingRefusedDetail(Object name) {
    return '$name と再度ペアリングしてください。このパソコンはこのスマートフォンのペアリングを受け付けなくなりました。';
  }

  @override
  String get connectionsPairingRePair => '再度ペアリング';

  @override
  String connectionsCurrent(String name) {
    return '$name · 現在';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint・$state';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint・$state・$route 経由';
  }

  @override
  String get connectionsRenameTitle => '接続の名前を変更';

  @override
  String get connectionsRenameField => '接続名';

  @override
  String get connectionsRenameEmpty => 'この接続の名前を入力してください。';

  @override
  String connectionsForgetTitle(String name) {
    return '「$name」を忘れますか？';
  }

  @override
  String get connectionsForgetMessage =>
      'このスマートフォンはそのコンピューターへの接続を停止し、ペアリングを忘れます。そこで実行中のタスクはそのまま動き続けます。';

  @override
  String get connectionsForgetConfirm => '削除';

  @override
  String connectionsMenuAria(String name) {
    return '$name の操作';
  }

  @override
  String get connectionsMenuForget => 'ホストを忘れる';

  @override
  String get hostScanQr => 'QR を読み取る';

  @override
  String get hostScanQrSubtitle => 'コンピューターに表示されたコードでペアリングします';

  @override
  String get hostPasteLink => 'リンクを貼り付け';

  @override
  String get hostPasteLinkSubtitle => 'EnvoyDev のペアリングリンクを貼り付けます';

  @override
  String get hostPasteLinkTitle => 'ペアリングリンクを貼り付け';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => '直接 TCP';

  @override
  String get hostDirectTcpSubtitle => 'ホスト、ポート、任意のトークン';

  @override
  String get hostRemoteSsh => 'リモート SSH';

  @override
  String get hostRemoteSshSubtitle => 'SSH 経由でサービスに接続します';

  @override
  String get hostFieldHostPort => 'host:port';

  @override
  String get hostFieldToken => 'トークン（ペアリング済みなら任意）';

  @override
  String get hostFieldTokenHelper => 'このスマートフォンにのみ保存され、一覧には表示されません。';

  @override
  String get hostFieldLabel => 'ラベル（任意）';

  @override
  String get hostFieldSshHost => 'SSH ホスト';

  @override
  String get hostFieldUser => 'ユーザー';

  @override
  String get hostFieldSshPort => 'SSH ポート';

  @override
  String get hostFieldPassword => 'パスワード';

  @override
  String get hostFieldDaemon => 'リモートのサービス（host:port）';

  @override
  String get hostFieldDaemonHelper => '通常はそのマシンの 127.0.0.1:4770';

  @override
  String get hostFieldPairingToken => 'ペアリングトークン（SSH 経由では任意）';

  @override
  String get hostFieldPairingTokenHelper => 'トンネルはマシン自身として届くため、信頼されます';

  @override
  String get hostRefusedTitle => 'マシンを追加できませんでした';

  @override
  String get hostScanTitle => 'ペアリングコードを読み取る';

  @override
  String get hostScanHint => 'コンピューターの QR コードにカメラを向けます。';

  @override
  String get hostNoHostsTitle => 'まだデスクトップがペアリングされていません';

  @override
  String get hostNoHostsBody =>
      'コンピューターで EnvoyDev を開き、「スマートフォンをペアリング」からコードを読み取ります。スマートフォンが接続していなくても、エージェントは動き続けます。';

  @override
  String get errorPairingEmpty => 'そのペアリングコードは空です。';

  @override
  String get errorPairingMalformed => 'ペアリングコードには見えません。';

  @override
  String get errorPairingUnreadable =>
      'そのペアリングコードを読み取れませんでした。デスクトップにもう一度表示してもらってください。';

  @override
  String get errorPairingAddress => 'そのペアリングコードのアドレスをこのアプリでは読み取れません。';

  @override
  String get errorPairingOtherApp => 'そのコードは別のアプリ用です';

  @override
  String get errorAddHostNotHostPort =>
      'ホストとポートの形式ではありません。「machine:4770」のように、アドレスとサービスが待ち受けるポートを書いてください。';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev はそのマシン自身以外からの接続を拒否するため、この経路にはペアリングリンクのトークンが必要です。「QR を読み取る」か「リンクを貼り付け」を使うか、ここにトークンも貼り付けてください。';

  @override
  String get errorAddHostSshHost => 'トンネルはどのマシン経由にしますか？その SSH ホストを入力してください。';

  @override
  String get errorAddHostSshPort => 'SSH ポートは 1〜65535 の数値にしてください。既定は 22 です。';

  @override
  String get errorAddHostDaemon =>
      'そのマシンのサービスは「host:port」の形式で指定します。「127.0.0.1:4770」と書いてください — ほとんどのマシンではこれで、そのマシンから見たアドレスです。';

  @override
  String get pairingNameTitle => 'この接続に名前を付ける';

  @override
  String get pairingNameField => '接続名';

  @override
  String get pairingNameHelper => '接続一覧に表示されます — アドレスも保持されます';

  @override
  String nameTooLong(int count) {
    return '$count 文字以内で入力してください。';
  }

  @override
  String get settingsTitle => '設定';

  @override
  String get settingsLoadFailed => '設定を読み込めませんでした。';

  @override
  String get settingsSaveFailed => '設定を保存できませんでした。';

  @override
  String get settingsSaveNoModel => '設定を保存しました。LLM 設定を保存するにはモデルを入力してください。';

  @override
  String get settingsSavedOnComputer => 'コンピューターに設定を保存しました。';

  @override
  String get settingsSavedLlmFailed => '設定は保存されましたが、LLM 設定は保存されませんでした。';

  @override
  String get settingsComputerHeading => 'コンピューター上';

  @override
  String get settingsComputerDetail =>
      'これらの設定はペアリングしたマシン側にあります。スマートフォンはそれを変更するだけです。';

  @override
  String get settingsPairingHeading => 'ペアリング';

  @override
  String settingsPairingPairedWith(Object name) {
    return 'このスマートフォンは $name とペアリング済みです。';
  }

  @override
  String get settingsPairingNotPaired =>
      'このスマートフォンはこのコンピューターとのペアリングを保持していません。コンピューターのコードをスキャンして再度ペアリングしてください。';

  @override
  String get settingsPairingUnavailable => 'このスマートフォンは保存されたペアリングを読み取れませんでした。';

  @override
  String get settingsPairingNotReached => 'このスマートフォンではまだ接続していません。';

  @override
  String settingsPairingMinutesAgo(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 分前に接続',
      one: '1 分前に接続',
    );
    return '$_temp0';
  }

  @override
  String settingsPairingHoursAgo(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 時間前に接続',
      one: '1 時間前に接続',
    );
    return '$_temp0';
  }

  @override
  String get settingsPairingJustNow => 'たった今接続';

  @override
  String get settingsPairingPhoneClock => 'このスマートフォンに、このスマートフォンの時計で記録されています。';

  @override
  String settingsPairingOnDate(Object date) {
    return '最終接続 $date';
  }

  @override
  String get settingsApprovals => '破壊的な操作の前に確認する';

  @override
  String get settingsTranscripts => 'タスク終了後も記録を残す';

  @override
  String get settingsLanguage => '言語';

  @override
  String get settingsLanguageSystem => 'システム';

  @override
  String get settingsDefaultAgent => '新しいタスクを始めるエージェント';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail => 'Envoy Harness のベース URL、モデル、API キー。';

  @override
  String get settingsBaseUrl => 'ベース URL';

  @override
  String get settingsBaseUrlHint => '任意 — 空欄ならプロバイダーの既定値を使います';

  @override
  String get settingsModel => 'モデル';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'API キーはこのマシンに保存されています。';

  @override
  String get settingsApiKey => 'API キー';

  @override
  String get settingsApiKeyHint => '保存済みのキーを置き換えるには新しいキーを貼り付け';

  @override
  String get settingsLanguageDaemonFailed =>
      'スマートフォンはこの言語になりましたが、コンピューターを更新できませんでした。';

  @override
  String get networkTitle => 'ネットワーク状態';

  @override
  String get networkCheckAgain => '再確認';

  @override
  String get networkCopyReport => 'レポートをコピー';

  @override
  String get networkCopied => 'ネットワークレポートをコピーしました — バグ報告に貼り付けてください。';

  @override
  String get networkTokenNote => 'ペアリングトークンはここには表示されません — 認証情報です。';

  @override
  String get networkComputer => 'コンピューター';

  @override
  String get networkActiveRoute => '使用中の経路';

  @override
  String get networkApp => 'アプリ';

  @override
  String get networkPairingHeading => 'ペアリングで得たもの';

  @override
  String get networkDesktopPeerId => 'デスクトップのピア ID';

  @override
  String get networkDialablePeers => 'ダイヤル可能なピアアドレス';

  @override
  String get networkPairingMissing =>
      'どちらもピアツーピア経路に必要なので、このホストにはどちらもありません。デスクトップがこれらの項目を持つ前に作られたペアリングにはどちらもなく、スマートフォンには直接アドレスとリレーだけが残ります。';

  @override
  String get networkLadderHeading => 'このコンピューターをどう試したか';

  @override
  String get networkLadderNoCandidatesYet =>
      '候補はまだありません — このコンピューターに対して何もダイヤルしていません。';

  @override
  String get networkLadderNoCandidates =>
      '今回の試行では候補が出ませんでした: ダイヤル負荷で試行が抑えられているか、ペアリングがアドレスをまったく示していません。';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return '今回の試行でダイヤルするのは最大 $limit: $total 件中 $waiting 件は次回に回ります。';
  }

  @override
  String get networkAttemptConnected => '接続済み';

  @override
  String get networkAttemptFailed => '失敗';

  @override
  String get networkAttemptNoAnswer => '応答なし';

  @override
  String get networkAttemptDialling => 'ダイヤル中';

  @override
  String get networkAttemptNotTried => '未試行';

  @override
  String get networkAttemptPlanned => '予定';

  @override
  String get networkLastRequestHeading => 'デスクトップへの最後のリクエスト';

  @override
  String get networkNothingAsked => 'アプリの起動後、まだ何も問い合わせていません。';

  @override
  String get networkMethod => 'メソッド';

  @override
  String get networkOutcome => '結果';

  @override
  String get networkAnswered => '応答あり';

  @override
  String get networkTook => '所要時間';

  @override
  String get networkLastWalk => '最後の試行';

  @override
  String get networkPhoneNodeHeading => 'このスマートフォンの libp2p ノード';

  @override
  String get networkNodeNotStarted =>
      '未起動 — この起動ではピアツーピア経路をまだダイヤルしていません。最初のダイヤルで起動し、この画面を見ても起動しません。';

  @override
  String get networkPeerId => 'ピア ID';

  @override
  String get networkStarting => '起動中';

  @override
  String get networkRelayDialling => 'リレーのダイヤル';

  @override
  String get networkEnabled => '有効';

  @override
  String get networkDisabled => '無効';

  @override
  String get networkRelayReservation => 'リレー予約';

  @override
  String get networkConnectedPeers => '接続中のピア';

  @override
  String get networkConnectedPeersUnavailable =>
      '利用できません — 共有ノードは接続の情報を公開していません';

  @override
  String get networkLanPeers => '検出した LAN ピア';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => 'アクティブ';

  @override
  String get networkInactive => '非アクティブ';

  @override
  String get networkRegisteredProtocols => '登録済みプロトコル';

  @override
  String get networkHostGeneration => 'ホストの世代';

  @override
  String get networkDesktopMeshHeading => 'デスクトップが自分について報告する内容';

  @override
  String get networkNotAsked =>
      'まだ問い合わせていません。「再確認」はデスクトップ自身のメッシュ状態を尋ねます — 「このスマートフォンからは到達できない」と「到達できる先がない」の違いです。';

  @override
  String networkNoUsableAnswer(String reason) {
    return '使える回答がありません: $reason';
  }

  @override
  String get networkUnreadable => '読み取り不能';

  @override
  String get networkState => '状態';

  @override
  String get networkItsPeerId => 'そのピア ID';

  @override
  String get networkItsDialable => 'そのダイヤル可能なアドレス';

  @override
  String get networkItsRelayHints => 'そのリレーヒント';

  @override
  String get networkPeersConnected => '接続しているピア';

  @override
  String get networkItsReason => 'その理由';

  @override
  String get explorerTitle => 'エクスプローラー';

  @override
  String get explorerFiles => 'ファイル';

  @override
  String get explorerChanges => '変更';

  @override
  String get explorerFolderEmpty => 'このフォルダは空です。';

  @override
  String get explorerCouldNotList => 'このフォルダを一覧できませんでした。';

  @override
  String get explorerNotRepo => 'このフォルダは Git リポジトリではありません。';

  @override
  String get explorerNoChanges => 'このフォルダに変更はありません。';

  @override
  String get explorerCommitMessage => 'コミットメッセージ';

  @override
  String get explorerCommitCta => 'コミット';

  @override
  String get explorerCommitStageAll => 'すべてステージ';

  @override
  String explorerCommitDone(String sha) {
    return '$sha をコミットしました。';
  }

  @override
  String explorerStage(String path) {
    return '$path をステージ';
  }

  @override
  String explorerUnstage(String path) {
    return '$path のステージを解除';
  }

  @override
  String get explorerCouldNotRead => '変更を読み取れませんでした。';

  @override
  String get explorerKindAdded => '追加';

  @override
  String get explorerKindModified => '変更済み';

  @override
  String get explorerKindDeleted => '削除';

  @override
  String get explorerKindRenamed => '名前変更';

  @override
  String get explorerKindNew => '新規';

  @override
  String get explorerKindConflict => '競合';

  @override
  String get folderTitle => 'プロジェクトのフォルダーを選択';

  @override
  String get folderUseThisFolder => 'このフォルダーを使う';

  @override
  String get folderComputer => 'コンピューター';

  @override
  String get folderDrives => 'ドライブ';

  @override
  String get folderHome => 'ホーム';

  @override
  String get folderParent => '親フォルダー';

  @override
  String get folderEmpty => 'サブフォルダーはありません';

  @override
  String get runStop => '停止';

  @override
  String get runStopping => '停止中…';

  @override
  String get runLive => '実行中';

  @override
  String get runToggleExplorer => 'エクスプローラーのサイドバーを切り替え';

  @override
  String get runCouldNotAnswer => 'その回答を送信できませんでした。もう一度お試しください。';

  @override
  String get runCouldNotUpdateTask => 'コンピューター上のタスクを更新できませんでした。';

  @override
  String get runCouldNotSend => '送信できませんでした。もう一度お試しください。';

  @override
  String get runCouldNotStop => '実行を停止できませんでした。もう一度お試しください。';

  @override
  String get runNoFolder => 'このタスクにはまだフォルダーがありません。';

  @override
  String get runCouldNotOpen => 'この実行を開けませんでした。';

  @override
  String get runEarlierNotHere => '以前の会話はこのコンピューターにありません。新しいメッセージはここから始められます。';

  @override
  String get runHistoryGap => 'このタスクの履歴の一部が届いていません。ここにあるものは順序どおりです。';

  @override
  String get runQueue => 'キュー';

  @override
  String get runSteer => '割り込み';

  @override
  String get runJoinsTurn => 'すぐにターンに割り込みます';

  @override
  String get runWaitsTurn => 'このターンの終了を待ちます';

  @override
  String get runPlaceholderAnswer => '先に上の要求に答えてください';

  @override
  String get runPlaceholderFollowUp => '追加のメッセージを送信…';

  @override
  String get runPlaceholderContinue => '続けるにはメッセージを送信してください';

  @override
  String get runYou => 'あなた';

  @override
  String get runYouSteered => 'あなた · ターンに割り込みました';

  @override
  String get runYouQueued => 'あなた · ターンを待っています';

  @override
  String get runThoughtTitle => 'どのように考えたか';

  @override
  String get runAnswered => '回答済み';

  @override
  String runAnsweredWith(String option) {
    return '回答済み: $option';
  }

  @override
  String get runNeedsAnswer => 'エージェントがあなたの回答を待っています';

  @override
  String approvalQuestionTool(String tool) {
    return 'エージェントに「$tool」の実行を許可しますか？';
  }

  @override
  String get approvalQuestionGeneric => 'エージェントの続行を許可しますか？';

  @override
  String get approvalQuestionAsk => 'エージェントが質問しました。';

  @override
  String get approvalDetail =>
      'この手順の前で止まっており、あなたが答えるまで続けません。許可すると、同じ操作はこのプロジェクトではもう尋ねません。';

  @override
  String get approvalDetailPick => '一つ選んでください。この回答はこの質問だけに対するものです。';

  @override
  String get approvalDetailMultiple =>
      '当てはまるものをすべて選んで、確認してください。この回答はこの質問だけに対するものです。';

  @override
  String get approvalDetailText => '回答を入力してください。送信するまでエージェントは続きません。';

  @override
  String get approvalAllow => '許可';

  @override
  String get approvalDeny => '許可しない';

  @override
  String get runApprovalNeedsDecision => 'エージェントが判断を待っています。';

  @override
  String get runNoLongerWaiting => 'もう待っていません。';

  @override
  String get runYourAnswer => 'あなたの回答';

  @override
  String get runToolFallback => 'ツール';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 個のファイルを変更しました。',
      one: '1 個のファイルを変更しました。',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return 'コンテキストが $percent% 埋まっています。';
  }

  @override
  String get runNoteFinished => '完了しました。';

  @override
  String get runNoteStopped => '停止しました。';

  @override
  String get runNoteStoppedBefore => '終わる前に停止しました。';

  @override
  String get runNoteEnded => '終了しました。';

  @override
  String get attachAdd => '画像を追加';

  @override
  String get attachTooltip => '添付';

  @override
  String get attachPaste => '画像を貼り付け';

  @override
  String get attachFile => 'ファイルを追加';

  @override
  String attachRemove(String name) {
    return '$name を削除';
  }

  @override
  String get attachTooBig => 'このファイルは大きすぎて添付できません。';

  @override
  String get attachBinary => '添付できるのは画像とテキストファイルだけです。';

  @override
  String get attachUnreadable => 'このファイルを読み取れませんでした。';

  @override
  String get attachEmpty => 'このファイルは空です。';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '添付は $count 件までです。',
      one: '添付は 1 件までです。',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => 'クリップボードに画像がありません。';

  @override
  String get attachFailed => 'そのファイルを添付できませんでした。';

  @override
  String get attachImagesOnly => '添付した画像を見てください。';

  @override
  String get attachImagesOnlyMany => '添付した画像を見てください。';

  @override
  String attachNamed(String names) {
    return '添付: $names';
  }

  @override
  String get addProjectTitle => 'プロジェクトを追加';

  @override
  String get addProjectDetail => 'このコンピューターのフォルダーを選びます。エージェントはその中で動きます。';

  @override
  String get addProjectFolder => 'フォルダー';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => '選択…';

  @override
  String get addProjectDefaultAgent => '既定のエージェント';

  @override
  String get addProjectChooseFolder => 'このコンピューターのフォルダーを選んでください。';

  @override
  String get addProjectSubmit => 'プロジェクトを追加';

  @override
  String get markdownMermaid =>
      'Mermaid 図 — ここにはソースを表示します。グラフはコンピューターのデスクトップアプリが描画します。';

  @override
  String get markdownCopy => 'コピー';

  @override
  String get markdownCopied => 'コピーしました';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 件のタスクがあなたを待っています',
      one: '1 件のタスクがあなたを待っています',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects =>
      'まだプロジェクトがありません — このコンピューターでフォルダーを追加してください。';

  @override
  String get projectListNoMatch => 'その検索に一致するものはありません。';

  @override
  String projectListCouldNotLoad(String detail) {
    return 'このコンピューターの作業を読み込めませんでした。$detail';
  }

  @override
  String get commonConnectionFailed => '接続できませんでした。';

  @override
  String get projectListCouldNotChangeAgent => 'プロジェクトのエージェントを変更できませんでした。';

  @override
  String projectListRemoveTitle(String project) {
    return '「$project」を削除しますか？';
  }

  @override
  String get projectListRemoveMessage =>
      'プロジェクトは EnvoyDev から外れ、そのタスクも一覧から外れます — 削除ではなくアーカイブで、そのフォルダーの中は何も変更されません。プロジェクトの削除は元に戻せません。';

  @override
  String projectListRemoveFailed(String project) {
    return '「$project」を削除できませんでした。一覧に残っています。';
  }

  @override
  String projectListRemoved(String project) {
    return '「$project」を削除しました。';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 件のタスクをアーカイブしました。',
      one: '1 件のタスクをアーカイブしました。',
    );
    return '「$project」を削除しました。$_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return '「$title」を削除しますか？';
  }

  @override
  String get taskRemoveMessage =>
      'タスク一覧から外れます。フォルダー、そのファイル、記録はこのコンピューターに残ります — アーカイブは削除ではありません。';

  @override
  String projectListRemoveTaskFailed(String title) {
    return '「$title」を削除できませんでした。一覧に残っています。';
  }

  @override
  String get runCouldNotRemove => 'このタスクを削除できませんでした。まだここにあります。';

  @override
  String get projectListRenameTaskTitle => 'タスクの名前を変更';

  @override
  String get projectListRenameTaskField => 'タスク名';

  @override
  String get projectListRenameTaskEmpty => 'このタスクの名前を入力してください。';

  @override
  String projectListRenameTaskFailed(String title) {
    return '「$title」の名前を変更できませんでした。名前は変わっていません。';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return '$host のネットワーク状態 — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return '接続を切り替え — 現在: $host';
  }

  @override
  String get projectListNoTasks => 'このプロジェクトにはまだタスクがありません';

  @override
  String projectListAgentFor(String project) {
    return '$project のエージェント';
  }

  @override
  String get projectListChangeAgent => 'エージェントを変更';

  @override
  String gitBranchesAria(String project) {
    return '$project のブランチ';
  }

  @override
  String get gitBranchesTitle => 'ブランチ';

  @override
  String gitBranchesChip(String branch) {
    return 'ブランチ: $branch';
  }

  @override
  String get gitBranchesDetachedChip => 'ブランチなし';

  @override
  String get gitBranchesDetached => 'このリポジトリは HEAD が切り離されているため、現在のブランチはありません。';

  @override
  String get gitBranchesEmpty => 'このリポジトリにはまだブランチがありません。';

  @override
  String get gitBranchesNew => '新しいブランチ';

  @override
  String get gitBranchesName => 'ブランチ名';

  @override
  String get gitBranchesCreate => '作成して切り替え';

  @override
  String gitBranchesSwitched(String branch) {
    return '$branch に切り替えました。';
  }

  @override
  String gitBranchesCreated(String branch) {
    return '$branch を作成し、切り替えました。';
  }

  @override
  String gitMergeInto(String branch, String current) {
    return '$branch を $current にマージ';
  }

  @override
  String get gitMergeCta => 'マージ';

  @override
  String gitMergeDone(String branch, String into) {
    return '$branch を $into にマージしました。';
  }

  @override
  String get gitFetchCta => 'フェッチ';

  @override
  String gitFetchDone(String summary) {
    return '取得しました。$summary';
  }

  @override
  String get gitFetchNothing => '取得しました。新しいものはありません。';

  @override
  String get gitPullCta => 'プル';

  @override
  String gitPullDone(String summary) {
    return '取り込みました。$summary';
  }

  @override
  String get gitPullNothing => '取り込みました。すでに最新です。';

  @override
  String errorGitMergeConflict(String branch, String files) {
    return '$branch は自動でマージできません。次のファイルが競合しています: $files。何も変更していません — ブランチと作業ツリーは元のままです。';
  }

  @override
  String get errorGitPullDiverged =>
      '手元のブランチとリモートのブランチが両方変わっているため、pull では統合できません。マージするか、自分のブランチを push してください。';

  @override
  String get gitStashTitle => 'スタッシュ';

  @override
  String get gitStashCta => 'スタッシュ';

  @override
  String get gitStashDone => 'しまっておきました。';

  @override
  String get gitStashPop => '戻す';

  @override
  String get gitStashDrop => '破棄';

  @override
  String get gitStashConfirm => 'このスタッシュを破棄しますか？';

  @override
  String get errorGitNothingToStash =>
      'しまっておく変更がありません。このフォルダに未コミットの変更があるファイルはありません。';

  @override
  String get errorGitStashDirty =>
      'スタッシュを戻すには作業ツリーがきれいである必要があります。先にこのフォルダの変更をコミットするかスタッシュしてください。';

  @override
  String errorGitStashConflict(String files) {
    return 'このスタッシュはきれいに戻せません。次のファイルが競合しています: $files。何も変更されておらず、スタッシュはそのまま残っています。';
  }

  @override
  String errorGitMergeUnresolved(String files) {
    return 'マージが完了していません: $files にまだ競合があります。解決してマージを完了するか、中止してください。';
  }

  @override
  String get errorGitMergeNone => '進行中のマージがないため、完了または中止するものはありません。';

  @override
  String errorGitConflicted(String files) {
    return 'このリポジトリには未解決の競合があります: $files。EnvoyDev が開始したものではない操作によるものです。ここで別のことをする前に、そちらで完了するか取り消してください。';
  }

  @override
  String errorGitMergeResolveFailed(String detail) {
    return 'エージェントを起動できなかったため、マージは取り消され、何も変更されていません: $detail';
  }

  @override
  String get gitMergeStopped => 'マージが競合で止まりました。';

  @override
  String gitMergeStoppedFrom(String branch) {
    return '$branch のマージが競合で止まりました。';
  }

  @override
  String get gitMergeResolved => '競合はすべて解決しました。マージを完了すると記録されます。';

  @override
  String get gitMergeResolve => 'エージェントに解決させる';

  @override
  String get gitMergeFinish => 'マージを完了';

  @override
  String get gitMergeAbort => 'マージを中止';

  @override
  String gitMergeResolving(String task) {
    return 'エージェントがこのマージを解決しています: $task。';
  }

  @override
  String get gitMergeAborted => 'マージを中止しました。何もマージされていません。';

  @override
  String get gitMergeRecorded => 'マージを記録しました。';

  @override
  String get gitBranchesConflictsChip => '競合';

  @override
  String get newTaskNoProjects => '先にコンピューターでプロジェクトを追加してから、もう一度お試しください。';

  @override
  String get newTaskProjectLabel => 'プロジェクト';

  @override
  String get newTaskPromptHint => 'タスクを説明';

  @override
  String newTaskCouldNotStart(String detail) {
    return 'そのタスクを開始できませんでした。$detail';
  }

  @override
  String get composerAgentDefault => 'エージェントの既定値';

  @override
  String get composerUse => '使用';

  @override
  String get composerAgentBare => 'エージェント';

  @override
  String composerModelValue(String value) {
    return 'モデル: $value';
  }

  @override
  String composerModeValue(String value) {
    return 'モード: $value';
  }

  @override
  String composerThinkingValue(String value) {
    return '思考: $value';
  }

  @override
  String get projectListSearchHint => 'タスク、リポジトリ、パスを検索';

  @override
  String get projectListRemoveConfirm => 'プロジェクトを削除';

  @override
  String projectListNewTaskIn(Object project) {
    return '$project の新しいタスク';
  }

  @override
  String get newTaskTitle => '新しいタスク';

  @override
  String get newTaskSubmitting => '追加中…';

  @override
  String get runRemoveTask => 'タスクを削除';

  @override
  String get composerDefault => '既定';

  @override
  String get composerModeSheet => 'モード';

  @override
  String get composerModeTooltip => 'このタスクでエージェントに許可されること';

  @override
  String get composerModelSheet => 'モデル';

  @override
  String get composerModelTooltip => 'このタスクでエージェントが使うモデル';

  @override
  String get composerModelHint => 'プロバイダー/モデル';

  @override
  String get composerThinkingSheet => '思考';

  @override
  String get composerThinkingTooltip => 'エージェントが答える前にどれだけ考えるか';

  @override
  String get taskUntitled => '無題のタスク';

  @override
  String get projectUnknown => '不明なプロジェクト';

  @override
  String get statusQueued => '待機中';

  @override
  String get statusDone => '完了';

  @override
  String get statusFailed => '失敗';

  @override
  String get statusUnknown => '不明';

  @override
  String get statusNeedsAnswer => 'あなたの回答待ち';

  @override
  String get statusWorking => '実行中';

  @override
  String get statusIdle => '待機';

  @override
  String get statusStopped => '停止';
}
