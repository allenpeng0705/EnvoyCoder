// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => '添加';

  @override
  String get commonCancel => '取消';

  @override
  String get commonClear => '清除';

  @override
  String get commonConfirm => '确认';

  @override
  String get commonContinue => '继续';

  @override
  String get commonNone => '无';

  @override
  String get commonNotSet => '未设置';

  @override
  String get commonOk => '确定';

  @override
  String get commonRemove => '移除';

  @override
  String get commonRename => '重命名';

  @override
  String get commonSave => '保存';

  @override
  String get commonSaving => '正在保存…';

  @override
  String get connectionStateConnected => '已连接';

  @override
  String get connectionStateConnecting => '正在连接';

  @override
  String get connectionStateReconnecting => '正在重新连接——你的任务仍在运行';

  @override
  String get connectionStateFailed => '不可达';

  @override
  String get connectionStateIdle => '尚未连接';

  @override
  String get connectionsTitle => '连接';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 台电脑',
      one: '1 台电脑',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => '添加主机';

  @override
  String get connectionsAddHostSubtitle => '扫描二维码，或输入地址';

  @override
  String get connectionsEmpty => '还没有配对电脑。';

  @override
  String connectionsCurrent(String name) {
    return '$name · 当前';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint（$state）';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint（$state）· 经 $route';
  }

  @override
  String get connectionsRenameTitle => '重命名连接';

  @override
  String get connectionsRenameField => '连接名称';

  @override
  String get connectionsRenameEmpty => '请输入这个连接的名称。';

  @override
  String connectionsForgetTitle(String name) {
    return '忘掉 $name？';
  }

  @override
  String get connectionsForgetMessage =>
      '这台手机会停止连接那台电脑，并忘掉它的配对。那里已在运行的任务会继续运行。';

  @override
  String get connectionsForgetConfirm => '删除';

  @override
  String connectionsMenuAria(String name) {
    return '$name 的操作';
  }

  @override
  String get connectionsMenuForget => '忘掉主机';

  @override
  String get hostScanQr => '扫描二维码';

  @override
  String get hostScanQrSubtitle => '用电脑上的配对码配对';

  @override
  String get hostPasteLink => '粘贴链接';

  @override
  String get hostPasteLinkSubtitle => '粘贴 EnvoyDev 的配对链接';

  @override
  String get hostPasteLinkTitle => '粘贴配对链接';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => '直连 TCP';

  @override
  String get hostDirectTcpSubtitle => '主机、端口和可选令牌';

  @override
  String get hostRemoteSsh => '远程 SSH';

  @override
  String get hostRemoteSshSubtitle => '通过 SSH 跳板访问服务';

  @override
  String get hostFieldHostPort => '主机:端口';

  @override
  String get hostFieldToken => '令牌（已配对时可留空）';

  @override
  String get hostFieldTokenHelper => '只保留在这台手机上——不会显示在列表中。';

  @override
  String get hostFieldLabel => '标签（可选）';

  @override
  String get hostFieldSshHost => 'SSH 主机';

  @override
  String get hostFieldUser => '用户';

  @override
  String get hostFieldSshPort => 'SSH 端口';

  @override
  String get hostFieldPassword => '密码';

  @override
  String get hostFieldDaemon => '远端服务（host:port）';

  @override
  String get hostFieldDaemonHelper => '该机器上通常是 127.0.0.1:4770';

  @override
  String get hostFieldPairingToken => '配对令牌（SSH 下可留空）';

  @override
  String get hostFieldPairingTokenHelper => '隧道以该机器自身的身份到达，因此受信任';

  @override
  String get hostRefusedTitle => '未能添加机器';

  @override
  String get hostScanTitle => '扫描配对码';

  @override
  String get hostScanHint => '把摄像头对准电脑上的二维码。';

  @override
  String get hostNoHostsTitle => '还没有配对电脑';

  @override
  String get hostNoHostsBody =>
      '在电脑上打开 EnvoyDev，选择“配对手机”，然后扫描配对码。无论手机是否连接，你的智能体都会继续运行。';

  @override
  String get errorPairingEmpty => '那个配对码是空的。';

  @override
  String get errorPairingMalformed => '这看起来不是配对码。';

  @override
  String get errorPairingUnreadable => '无法读取那个配对码。请在电脑上重新显示一次。';

  @override
  String get errorPairingAddress => '那个配对码里有本应用读不了的地址。';

  @override
  String get errorPairingOtherApp => '那个码属于另一个应用。';

  @override
  String get errorAddHostNotHostPort =>
      '这不是主机和端口。请写成“machine:4770”——地址，加上服务监听的端口。';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev 会拒绝不在这台机器本身上的人，所以这条路径需要配对链接里的令牌。请用“扫描二维码”或“粘贴链接”，或者把令牌也粘贴到这里。';

  @override
  String get errorAddHostSshHost => '隧道要经过哪台机器？请输入它的 SSH 主机。';

  @override
  String get errorAddHostSshPort => 'SSH 端口必须是 1 到 65535 之间的数字。默认是 22。';

  @override
  String get errorAddHostDaemon =>
      '那台机器上的服务写作“host:port”。请写成“127.0.0.1:4770”——几乎所有机器都是这个，而且它是从该机器自身看到的地址。';

  @override
  String get pairingNameTitle => '给这个连接命名';

  @override
  String get pairingNameField => '连接名称';

  @override
  String get pairingNameHelper => '显示在连接列表中——地址也会保留。';

  @override
  String nameTooLong(int count) {
    return '请控制在 $count 个字符以内。';
  }

  @override
  String get settingsTitle => '设置';

  @override
  String get settingsLoadFailed => '无法加载设置。';

  @override
  String get settingsSaveFailed => '无法保存设置。';

  @override
  String get settingsSaveNoModel => '设置已保存。要保存 LLM 设置，请输入模型。';

  @override
  String get settingsSavedOnComputer => '设置已保存在电脑上。';

  @override
  String get settingsSavedLlmFailed => '设置已保存，但 LLM 设置没有保存。';

  @override
  String get settingsComputerHeading => '在这台电脑上';

  @override
  String get settingsComputerDetail => '这些设置保存在已配对的机器上，手机只负责修改。';

  @override
  String get settingsApprovals => '执行任何破坏性操作前先询问';

  @override
  String get settingsTranscripts => '任务结束后保留对话记录';

  @override
  String get settingsLanguage => '语言';

  @override
  String get settingsLanguageSystem => '跟随本机';

  @override
  String get settingsDefaultAgent => '新任务默认使用的智能体';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail => 'Envoy Harness 的基址、模型和 API 密钥。';

  @override
  String get settingsBaseUrl => '基址 URL';

  @override
  String get settingsBaseUrlHint => '可选——留空则使用提供商的默认地址';

  @override
  String get settingsModel => '模型';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'API 密钥已保存在本机。';

  @override
  String get settingsApiKey => 'API 密钥';

  @override
  String get settingsApiKeyHint => '粘贴新密钥以替换已保存的密钥';

  @override
  String get settingsLanguageDaemonFailed => '手机已改用这种语言，但无法更新电脑。';

  @override
  String get networkTitle => '网络状态';

  @override
  String get networkCheckAgain => '重新检查';

  @override
  String get networkCopyReport => '复制报告';

  @override
  String get networkCopied => '网络报告已复制——把它粘贴到问题报告里。';

  @override
  String get networkTokenNote => '配对令牌不会显示在这里——它是凭据。';

  @override
  String get networkComputer => '电脑';

  @override
  String get networkActiveRoute => '当前路径';

  @override
  String get networkApp => '应用';

  @override
  String get networkPairingHeading => '配对带来的信息';

  @override
  String get networkDesktopPeerId => '电脑对等节点 ID';

  @override
  String get networkDialablePeers => '可拨号的对等节点地址';

  @override
  String get networkPairingMissing =>
      '点对点路径两者都需要，所以这台主机一项也没有。在电脑开始携带这些字段之前完成的配对两者都没有——手机只剩直连地址和中继。';

  @override
  String get networkLadderHeading => '这台电脑是如何被尝试的';

  @override
  String get networkLadderNoCandidatesYet => '还没有候选——尚未为这台电脑拨过号。';

  @override
  String get networkLadderNoCandidates => '这一轮没有产生候选：拨号压力下遍历被暂缓，或者配对里根本没有地址。';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return '这一轮最多拨号 $limit 个：$total 个中有 $waiting 个留到下一轮。';
  }

  @override
  String get networkAttemptConnected => '已连接';

  @override
  String get networkAttemptFailed => '失败';

  @override
  String get networkAttemptNoAnswer => '无应答';

  @override
  String get networkAttemptDialling => '正在拨号';

  @override
  String get networkAttemptNotTried => '未尝试';

  @override
  String get networkAttemptPlanned => '已计划';

  @override
  String get networkLastRequestHeading => '最后一次发往电脑的请求';

  @override
  String get networkNothingAsked => '应用启动以来还没有发起过任何请求。';

  @override
  String get networkMethod => '方法';

  @override
  String get networkOutcome => '结果';

  @override
  String get networkAnswered => '已应答';

  @override
  String get networkTook => '耗时';

  @override
  String get networkLastWalk => '上次遍历';

  @override
  String get networkPhoneNodeHeading => '这台手机的 libp2p 节点';

  @override
  String get networkNodeNotStarted =>
      '未启动——本次启动还没有拨号过任何点对点路径。它会在第一次这样的拨号时启动，而查看此界面并不会启动它。';

  @override
  String get networkPeerId => '对等节点 ID';

  @override
  String get networkStarting => '正在启动';

  @override
  String get networkRelayDialling => '中继拨号';

  @override
  String get networkEnabled => '已启用';

  @override
  String get networkDisabled => '已禁用';

  @override
  String get networkRelayReservation => '中继预留';

  @override
  String get networkConnectedPeers => '已连接的对等节点';

  @override
  String get networkConnectedPeersUnavailable => '不可用——共享节点没有提供连接视图';

  @override
  String get networkLanPeers => '看到的局域网对等节点';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => '活跃';

  @override
  String get networkInactive => '不活跃';

  @override
  String get networkRegisteredProtocols => '已注册的协议';

  @override
  String get networkHostGeneration => '主机代次';

  @override
  String get networkDesktopMeshHeading => '电脑对自己的说明';

  @override
  String get networkNotAsked =>
      '尚未询问。点“重新检查”会向电脑询问它自己的 mesh 状态——这正是“这台手机连不上”与“它没有任何可连的东西”之间的区别。';

  @override
  String networkNoUsableAnswer(String reason) {
    return '没有可用的答复：$reason';
  }

  @override
  String get networkUnreadable => '无法读取';

  @override
  String get networkState => '状态';

  @override
  String get networkItsPeerId => '它的对等节点 ID';

  @override
  String get networkItsDialable => '它的可拨号地址';

  @override
  String get networkItsRelayHints => '它的中继提示';

  @override
  String get networkPeersConnected => '它已连接的对等节点';

  @override
  String get networkItsReason => '它的原因';

  @override
  String get explorerTitle => '资源管理器';

  @override
  String get explorerFiles => '文件';

  @override
  String get explorerChanges => '更改';

  @override
  String get explorerFolderEmpty => '这个文件夹是空的。';

  @override
  String get explorerCouldNotList => '无法列出这个文件夹。';

  @override
  String get explorerNotRepo => '这个文件夹不是 Git 仓库。';

  @override
  String get explorerNoChanges => '这个文件夹没有更改。';

  @override
  String get explorerCouldNotRead => '无法读取更改。';

  @override
  String get explorerKindAdded => '新增';

  @override
  String get explorerKindModified => '已修改';

  @override
  String get explorerKindDeleted => '已删除';

  @override
  String get explorerKindRenamed => '已重命名';

  @override
  String get explorerKindNew => '新文件';

  @override
  String get explorerKindConflict => '冲突';

  @override
  String get folderTitle => '选择项目文件夹';

  @override
  String get folderUseThisFolder => '使用这个文件夹';

  @override
  String get folderComputer => '电脑';

  @override
  String get folderDrives => '驱动器';

  @override
  String get folderHome => '主目录';

  @override
  String get folderParent => '上级文件夹';

  @override
  String get folderEmpty => '这里没有子文件夹';

  @override
  String get runStop => '停止';

  @override
  String get runStopping => '正在停止…';

  @override
  String get runLive => '运行中';

  @override
  String get runToggleExplorer => '切换资源管理器侧栏';

  @override
  String get runCouldNotAnswer => '无法发送那个答复。请重试。';

  @override
  String get runCouldNotUpdateTask => '无法更新电脑上的任务。';

  @override
  String get runCouldNotSend => '无法发送。请重试。';

  @override
  String get runCouldNotStop => '无法停止这次运行。请重试。';

  @override
  String get runNoFolder => '这个任务还没有文件夹。';

  @override
  String get runCouldNotOpen => '无法打开这次运行。';

  @override
  String get runEarlierNotHere => '更早的对话不在这台电脑上。新消息仍可以从这里开始。';

  @override
  String get runHistoryGap => '这个任务的部分历史没有到达。这里的内容顺序正确。';

  @override
  String get runQueue => '排队';

  @override
  String get runSteer => '介入';

  @override
  String get runJoinsTurn => '立即加入本轮';

  @override
  String get runWaitsTurn => '等待本轮结束';

  @override
  String get runPlaceholderAnswer => '请先回答上面的请求';

  @override
  String get runPlaceholderFollowUp => '发送一条后续消息…';

  @override
  String get runPlaceholderContinue => '发送消息以继续';

  @override
  String get runYou => '你';

  @override
  String get runYouSteered => '你 · 已切入本轮';

  @override
  String get runYouQueued => '你 · 已排队等待本轮';

  @override
  String get runThoughtTitle => '它是如何思考的';

  @override
  String get runAnswered => '已答复';

  @override
  String runAnsweredWith(String option) {
    return '已答复：$option';
  }

  @override
  String get runNeedsAnswer => '智能体需要你的答复';

  @override
  String approvalQuestionTool(String tool) {
    return '允许智能体运行“$tool”吗？';
  }

  @override
  String get approvalQuestionGeneric => '允许智能体继续吗？';

  @override
  String get approvalQuestionAsk => '智能体提了一个问题。';

  @override
  String get approvalDetail => '它已在此步骤前停下，在你答复之前不会继续。允许之后，同样的操作在这个项目里不会再询问。';

  @override
  String get approvalDetailPick => '请选一个。这个回答只针对这个问题。';

  @override
  String get approvalDetailMultiple => '勾选所有适用的选项，然后确认。这个回答只针对这个问题。';

  @override
  String get approvalDetailText => '请输入你的回答。在你发送之前，智能体不会继续。';

  @override
  String get approvalAllow => '允许';

  @override
  String get approvalDeny => '不允许';

  @override
  String get runApprovalNeedsDecision => '智能体需要你做个决定。';

  @override
  String get runNoLongerWaiting => '不再等待。';

  @override
  String get runYourAnswer => '你的答复';

  @override
  String get runToolFallback => '工具';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 个文件已更改。',
      one: '1 个文件已更改。',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return '上下文已用 $percent%。';
  }

  @override
  String get runNoteFinished => '已完成。';

  @override
  String get runNoteStopped => '已停止。';

  @override
  String get runNoteStoppedBefore => '在完成前停止。';

  @override
  String get runNoteEnded => '已结束。';

  @override
  String get attachAdd => '添加图片';

  @override
  String get attachTooltip => '附件';

  @override
  String get attachPaste => '粘贴图片';

  @override
  String get attachFile => '添加文件';

  @override
  String attachRemove(String name) {
    return '移除 $name';
  }

  @override
  String get attachTooBig => '这个文件太大，无法添加。';

  @override
  String get attachBinary => '只能添加图片和文本文件。';

  @override
  String get attachUnreadable => '无法读取这个文件。';

  @override
  String get attachEmpty => '这个文件是空的。';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '最多可以添加 $count 个文件。',
      one: '只能添加 1 个文件。',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => '剪贴板中没有图片。';

  @override
  String get attachFailed => '无法添加该文件。';

  @override
  String get attachImagesOnly => '请看这张图片。';

  @override
  String get attachImagesOnlyMany => '请看这些图片。';

  @override
  String attachNamed(String names) {
    return '附件：$names';
  }

  @override
  String get addProjectTitle => '添加项目';

  @override
  String get addProjectDetail => '在这台电脑上选择一个文件夹。智能体将在其中运行。';

  @override
  String get addProjectFolder => '文件夹';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => '选择…';

  @override
  String get addProjectDefaultAgent => '默认智能体';

  @override
  String get addProjectChooseFolder => '请在这台电脑上选择一个文件夹。';

  @override
  String get addProjectSubmit => '添加项目';

  @override
  String get markdownMermaid => 'Mermaid 图表——这里显示源码；图表由电脑上的桌面应用绘制。';

  @override
  String get markdownCopy => '复制';

  @override
  String get markdownCopied => '已复制';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 个任务需要你',
      one: '1 个任务需要你',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects => '还没有项目——在这台电脑上添加一个文件夹。';

  @override
  String get projectListNoMatch => '没有匹配的内容。';

  @override
  String projectListCouldNotLoad(String detail) {
    return '无法从这台电脑加载任务。$detail';
  }

  @override
  String get commonConnectionFailed => '连接失败。';

  @override
  String get projectListCouldNotChangeAgent => '无法更改项目的智能体。';

  @override
  String projectListRemoveTitle(String project) {
    return '移除“$project”？';
  }

  @override
  String get projectListRemoveMessage =>
      '项目会离开 EnvoyDev，它的任务也会离开列表——它们被归档，而不是被删除，那个文件夹里的内容不受影响。移除项目后无法撤销。';

  @override
  String projectListRemoveFailed(String project) {
    return '无法移除“$project”。它仍在列表中。';
  }

  @override
  String projectListRemoved(String project) {
    return '已移除“$project”。';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count 个任务已归档。',
      one: '1 个任务已归档。',
    );
    return '已移除“$project”。$_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return '移除“$title”？';
  }

  @override
  String get taskRemoveMessage => '它会离开任务列表。文件夹、里面的文件和对话记录都留在这台电脑上——归档不是删除。';

  @override
  String projectListRemoveTaskFailed(String title) {
    return '无法移除“$title”。它仍在列表中。';
  }

  @override
  String get runCouldNotRemove => '无法移除这个任务。它仍在这里。';

  @override
  String get projectListRenameTaskTitle => '重命名任务';

  @override
  String get projectListRenameTaskField => '任务名称';

  @override
  String get projectListRenameTaskEmpty => '请输入这个任务的名称。';

  @override
  String projectListRenameTaskFailed(String title) {
    return '无法重命名“$title”。名称未更改。';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return '$host 的网络状态——$state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return '切换连接——当前：$host';
  }

  @override
  String get projectListNoTasks => '这个项目里还没有任务';

  @override
  String projectListAgentFor(String project) {
    return '$project 的智能体';
  }

  @override
  String get projectListChangeAgent => '更改智能体';

  @override
  String get newTaskNoProjects => '请先在电脑上添加项目，然后重试。';

  @override
  String get newTaskProjectLabel => '项目';

  @override
  String get newTaskPromptHint => '描述这个任务';

  @override
  String newTaskCouldNotStart(String detail) {
    return '无法启动那个任务。$detail';
  }

  @override
  String get composerAgentDefault => '智能体自己的默认值';

  @override
  String get composerUse => '使用';

  @override
  String get composerAgentBare => '智能体';

  @override
  String composerModelValue(String value) {
    return '模型：$value';
  }

  @override
  String composerModeValue(String value) {
    return '模式：$value';
  }

  @override
  String composerThinkingValue(String value) {
    return '思考：$value';
  }

  @override
  String get projectListSearchHint => '搜索任务、仓库、路径';

  @override
  String get projectListRemoveConfirm => '移除项目';

  @override
  String projectListNewTaskIn(Object project) {
    return '$project 中的新任务';
  }

  @override
  String get newTaskTitle => '新建任务';

  @override
  String get newTaskSubmitting => '正在添加…';

  @override
  String get runRemoveTask => '移除任务';

  @override
  String get composerDefault => '默认';

  @override
  String get composerModeSheet => '模式';

  @override
  String get composerModeTooltip => '智能体在此任务中允许做什么';

  @override
  String get composerModelSheet => '模型';

  @override
  String get composerModelTooltip => '智能体在此任务中使用哪个模型';

  @override
  String get composerModelHint => '提供商/模型';

  @override
  String get composerThinkingSheet => '思考';

  @override
  String get composerThinkingTooltip => '智能体在回答前思考多少';

  @override
  String get taskUntitled => '无标题任务';

  @override
  String get projectUnknown => '未知项目';

  @override
  String get statusQueued => '排队中';

  @override
  String get statusDone => '已完成';

  @override
  String get statusFailed => '失败';

  @override
  String get statusUnknown => '未知';

  @override
  String get statusNeedsAnswer => '需要你的回答';

  @override
  String get statusWorking => '运行中';

  @override
  String get statusIdle => '空闲';

  @override
  String get statusStopped => '已停止';
}
