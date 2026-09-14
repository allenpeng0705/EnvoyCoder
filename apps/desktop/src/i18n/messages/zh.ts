/**
 * zh — the catalogue every string in this window is rendered from.
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

export const zh: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "本机",
  "app.rail.show": "显示项目",
  "app.rail.hide": "隐藏项目",
  "app.rail.toggle": "切换项目栏",
  "app.windows.count": "{count} 个窗口",
  "app.windows.title": "该服务为所有 EnvoyCoder 窗口提供连接",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "正在启动…",
  "connection.unreachable": "服务不可达",
  "connection.none": "未连接",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "关闭",

  /* ── the rail ── */
  "sidebar.aria": "项目与任务",
  "sidebar.add": "+ 添加项目",
  "sidebar.add.title": "把一个目录注册为项目",
  "sidebar.command.title": "打开命令中心",
  "sidebar.search.placeholder": "搜索任务、仓库、路径",
  "sidebar.search.aria": "搜索任务、仓库和路径",
  "sidebar.view.groupBy": "按项目分组",
  "sidebar.view.flat": "单一列表，最新的在前",
  "sidebar.view.group": "分组",
  "sidebar.view.list": "列表",
  "sidebar.attention.one": "1 个任务需要你",
  "sidebar.attention.many": "{count} 个任务需要你",
  "sidebar.empty.title": "还没有项目",
  "sidebar.empty.body": "添加一个你工作的目录。在其中启动的任务会出现在这里，项目会记住它们该用哪个智能体。",
  "sidebar.empty.noMatch": "没有匹配“{query}”的内容。",
  "sidebar.empty.cannotLoadTitle": "无法读取你的项目",
  "sidebar.empty.cannotLoadBody": "这个列表是未知的，而不是空的——EnvoyCoder 无法向守护进程查询。",
  "sidebar.section.tasks": "任务",
  "sidebar.project.attention": "等待你处理的任务",
  "sidebar.project.agent": "该项目中新任务默认使用的智能体",
  "sidebar.project.settings": "项目设置",
  "sidebar.project.settings.aria": "{project} 的项目设置",
  "sidebar.project.newTask": "+ 新建",
  "sidebar.project.newTask.title": "在 {project} 中启动任务",
  "sidebar.tasks.empty": "这里还没有任务。",
  "sidebar.footer.add": "添加项目",
  "sidebar.footer.host": "主机：{host}",
  "sidebar.footer.import": "导入会话（尚未实现）",
  "sidebar.footer.import.title": "从其他智能体的历史记录中导入会话尚未实现——每个智能体都需要一个读取器。",
  "sidebar.footer.help": "帮助与支持（尚未实现）",
  "sidebar.footer.help.title": "还没有帮助界面：快捷键注册表已经有了，帮助面板还没有。",
  "sidebar.footer.settings": "设置",

  /* ── the command palette ── */
  "palette.title": "命令中心",
  "palette.placeholder": "输入命令",
  "palette.search.aria": "搜索命令",
  "palette.value": "值",
  "palette.selected": "已选中",
  "palette.empty": "没有匹配项。",
  "palette.group.projects": "项目",
  "palette.group.tasks": "任务",
  "palette.group.machine": "本机",
  "palette.addProject.title": "添加项目…",
  "palette.addProject.subtitle": "注册一个你工作的目录",
  "palette.addProject.pickPrompt": "选择项目文件夹",
  "palette.addProject.noFolder": "没有选择文件夹，因此未添加任何内容。",
  "palette.addProject.needs": "哪个文件夹？请粘贴完整路径。",
  "palette.addProject.needsPlaceholder": "/Users/you/work/repo",
  "palette.newTask.title": "{project} 中的新任务",
  "palette.openTask.subtitle": "打开此任务",
  "palette.pairPhone.title": "配对手机",
  "palette.pairPhone.subtitle": "显示移动应用可扫描的配对码",
  "palette.pairPhone.notYet": "手机配对将随移动端里程碑到来：服务还没有会话存储，因此它有意拒绝远程客户端。",
  "palette.toggleRail.title": "切换项目栏",
  "palette.settings.title": "打开设置",
  "palette.settings.subtitle": "新任务的默认值，以及哪些操作需要批准",
  "palette.noPicker": "该窗口没有可询问的 shell，请改为粘贴文件夹路径。",
  "palette.pickerFailed": "无法打开文件夹选择器：{detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder 无法连接到它的服务",
  "work.offline.body": "服务是运行你任务的进程，它没有响应。它随应用一起启动，所以通常稍等一下就会恢复。",
  "work.loading": "正在加载你的项目…",
  "work.noTask.title": "未打开任务",
  "work.noTask.body": "在左侧选择一个任务，或在某个项目中启动一个。智能体在这台机器上运行；接入 mesh 后，也会在你的其他机器上运行。",
  "work.noProjects.title": "还没有项目",
  "work.noProjects.body": "添加一个你工作的目录，EnvoyCoder 就能在其中运行智能体。",
  "work.noTask.action": "启动任务",
  "work.noProjects.action": "添加项目",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "任务 {title}",
  "task.untitled": "未命名",
  "task.meta.agent": "运行此任务的智能体",
  "task.meta.cwd": "工作目录：{path}",
  "task.meta.host": "运行此任务的机器",
  "task.cancel": "停止",
  "task.cancel.title": "请智能体停止",
  "task.transcript.gap": "此任务的部分历史没有到达。这里的内容顺序正确；重新加载即可再次请求。",
  "task.transcript.empty.title": "还没有内容",
  "task.transcript.empty.body": "提出请求后，智能体就在 {cwd} 中工作。工具调用、批准和差异会在此实时出现。",
  "task.you": "你",
  "task.delivered.steered": "已切入本轮",
  "task.delivered.queued": "已排队等待本轮",
  "task.thought.summary": "它是如何思考的",
  "task.approval.aria": "智能体需要你的答复",
  "task.approval.answered": "已答复",
  "task.approval.answeredWith": "已答复：{option}",
  "task.composer.aria": "给智能体发消息",
  "task.composer.placeholder.approval": "请先回答上面的请求，再发送任何内容",
  "task.composer.placeholder.running": "追加一条消息——「排队」等待本轮结束，「介入」加入本轮",
  "task.composer.placeholder.idle": "描述这个任务",
  "task.composer.queue": "排队",
  "task.composer.steer": "介入",
  "task.composer.mode.aria": "消息如何送达",
  "task.composer.mode.title": "「排队」等待当前轮次；「介入」加入其中",
  "task.composer.send": "发送",
  "task.composer.start": "启动",
  "task.composer.submit.blocked": "请先回答上面的请求",

  /* ── a status, in the words a user reads ── */
  "status.queued": "等待启动",
  "status.running": "运行中",
  "status.needsAttention": "需要你的回答",
  "status.idle": "空闲",
  "status.done": "已完成",
  "status.failed": "出错停止",
  "status.cancelled": "已停止",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "已完成。",
  "run.end.cancelled": "已停止。",
  "run.end.failed": "在完成前停止。",
  "run.end.other": "已结束。",
  "run.diff.one": "1 个文件已更改。",
  "run.diff.many": "{count} 个文件已更改。",
  "run.context": "上下文已用 {percent}%。",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "Mesh 已连接 — {count} 台机器可达",
  "mesh.attached.none": "Mesh 已连接 — 暂时没有其他机器可达",
  "mesh.noNode": "EnvoyMesh 未运行 — 任务留在这台机器上",
  "mesh.refused": "EnvoyMesh 拒绝为 EnvoyCoder 授予会话 — 任务留在这台机器上",
  "mesh.peers": "{count} 个对等节点",
  "mesh.scope.title": "会话范围 {scope}",
  "mesh.agentsHere": "智能体在这台机器上运行",

  /* ── settings ── */
  "settings.title": "设置",
  "settings.close": "关闭",
  "settings.stateDir": "数据位于 {path}",
  "settings.noDaemon": "无服务",
  "settings.daemon": "服务 {version}",
  "settings.daemon.title": "该窗口连接的服务",
  "settings.language.title": "语言",
  "settings.language.detail": "此窗口的语言——所有标签、提示和错误，包括服务返回的那些。它与你的设置一起保存在这台机器上，因此会跟随你到其他窗口和手机。",
  "settings.language.aria": "语言",
  "settings.language.system": "跟随本机",
  "settings.defaultHarness.title": "新任务默认使用的智能体",
  "settings.defaultHarness.detail": "项目可以覆盖它；项目没有覆盖时以此为准。",
  "settings.needsInstalling": "（需要安装）",
  "settings.approvals.title": "执行任何破坏性操作前先询问",
  "settings.approvals.detail": "智能体会停下来等你，而不是直接覆盖文件。关闭它意味着任务可以不经询问就改动你的工作区。",
  "settings.remoteRuns.title": "把本机的智能体共享给你的其他机器",
  "settings.remoteRuns.detail": "默认关闭。开启后，来自你其他机器的任务可以在这里、在你的某个目录中运行。",
  "settings.transcripts.title": "任务结束后保留对话记录",
  "settings.transcripts.detail": "智能体做过什么的记录，保存在这台机器上。关闭它可以省空间，但会让“它改了什么？”以后无法回答。",
  "settings.agents.heading": "本机上的智能体",
  "settings.agents.note": "每个智能体实际能做什么，决定了 EnvoyCoder 提供什么。无法被请求许可的智能体，不会被塞给它一个会被忽略的批准对话框。",
  "settings.agents.empty": "智能体列表还没有到达。",
  "settings.agent.notInstalled": "未安装",
  "settings.agent.unknown": "未知",
  "settings.agent.ready": "就绪",
  "settings.agent.noApprovals": "无批准",
  "settings.agent.noApprovals.title": "该智能体行动前从不询问",
  "settings.agent.noCancel": "无法取消",
  "settings.agent.noCancel.title": "停止该智能体的唯一方法是结束其进程",
  "settings.notes.heading": "值得了解的事项",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path} 在这台机器上不是目录。请选择一个存在的文件夹——EnvoyCoder 要在其中运行智能体，路径必须真实存在。",
  "error.createTask.notDirectory": "{path} 在这台机器上不是目录，因此没有地方运行智能体。它曾是“{title}”的工作目录。",
  "error.projectNotFound": "这台机器上没有名为“{id}”的项目。它可能已在另一个窗口中被移除。",
  "error.taskNotFound": "这台机器上没有名为“{id}”的任务。它可能已在另一个窗口中被移除。",
  "error.runNotFound": "没有名为“{runId}”的运行。它可能是由一个其后重启过的服务启动的。",
  "error.taskForRunMissing": "没有名为“{taskId}”的任务，因此没有地方运行智能体。",
  "error.taskAlreadyRunning": "“{task}”已在运行。请改为给它发消息——在同一个目录里启动第二个智能体，正是两者开始编辑同一个文件的途径。",
  "error.runFinished": "那次运行已经结束，因此没有可发送的对象。请改为启动一个新任务。",
  "error.approvalPending": "智能体正在等待答复才能继续。请先回答它——现在发送的消息只会排在它后面。",
  "error.noRunRuntime": "该服务启动时没有智能体运行时，因此无法运行任务。",
  "error.harnessMissing": "这台机器上没有安装 {harness}。安装它，然后重新启动任务。",
  "error.harnessUnsupported": "{harness} 使用的协议 EnvoyCoder 还无法驱动（该适配器只驱动 ACP 智能体）。Envoy Harness 和 DeepSeek Harness 目前可用；{harness} 需要自己的适配器。",
  "error.notConnected": "EnvoyCoder 还没有连接到它的服务。",
  "error.notConnectedChange": "EnvoyCoder 未连接到它的服务，因此该更改没有被保存。",
  "error.connectionClosed": "连接已关闭。",
  "error.daemonClosedConnection": "服务关闭了连接。",
  "error.daemonTooOld": "此窗口连接的守护进程是较旧的版本：它不认识 {method}。请重启 EnvoyCoder，让窗口与守护进程使用同一版本，然后重试。",
  "error.notOurDaemon.product": "服务的端口上有东西在应答，但它自称“{product}”。EnvoyCoder 没有连接它。",
  "error.notOurDaemon.instance": "端口 {port} 上的服务不是这个窗口启动时要找的那个。可能有另一个 EnvoyCoder 服务取代了它——请重新打开窗口。",
  "error.shellEndpointFailed": "EnvoyCoder 的窗口无法向 shell 询问服务在哪里。请重新构建桌面应用（shell 的权限列表已过期）。",
  "error.shellEndpointMissing": "EnvoyCoder 的 shell 没有说明它的服务在哪里。没有这个信息，窗口无法连接。",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder 无法读取 {name}，于是把它移到 {movedTo}，并将该列表以空状态重新开始。（{reason}）",
  "note.quarantined.left": "EnvoyCoder 无法读取 {name}，也无法把它移开，于是保持原样，并将该列表以空状态重新开始。（{reason}）",
  "note.skipped": "{file}：{reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "允许智能体运行“{tool}”吗？",
  "approval.question.generic": "允许智能体继续吗？",
  "approval.detail": "它已在此步骤前停下，在你答复之前不会继续。回答这一个请求并不代表允许其他任何事情。",
};
