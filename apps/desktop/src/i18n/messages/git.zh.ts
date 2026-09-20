/**
 * The **git** sentences of the Chinese catalogue, one namespace of it.
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
  "error.gitNothingStaged": "没有已暂存的改动，因此没有可提交的内容。请先暂存一个文件——或者全部。",
  "error.gitMergeConflict": "{branch} 无法自动合并。这些文件有冲突：{files}。没有做任何改动——你的分支和工作区保持原样。",
  "error.gitPullDiverged": "电脑上的分支和远程的分支都变了，pull 无法把它们合到一起。请合并它们，或者推送你的分支。",
  "error.gitNothingToStash": "没有可以把放到一边的内容——这个文件夹里没有文件有未提交的改动。",
  "error.gitStashDirty": "把放到一边的工作放回来，工作区必须是干净的。请先提交或暂存这个文件夹里的改动。",
  "error.gitStashConflict": "这份放到一边的工作无法干净地放回来。这些文件有冲突：{files}。没有任何改动发生，放到一边的工作还在。",
  "git.stash.title": "放到一边的工作",
  "git.stash.cta": "放到一边",
  "git.stash.done": "已放到一边。",
  "git.stash.pop": "放回来",
  "git.stash.drop": "丢弃",
  "git.stash.confirm": "丢弃这份放到一边的工作？",
  "git.stash.empty": "没有放到一边的工作。",
  "git.merge.into": "把 {branch} 合并到 {current}",
  "git.merge.cta": "合并",
  "git.merge.done": "已把 {branch} 合并到 {into}。",
  "error.gitMergeUnresolved": "有一个合并还没有完成：{files} 仍有冲突。请解决冲突并完成合并，或者放弃它。",
  "error.gitMergeNone": "当前没有进行中的合并，因此没有可完成或放弃的操作。",
  "error.gitConflicted": "这个仓库里有未解决的冲突：{files}，来自一个不是 EnvoyDev 启动的操作。请到那里完成或撤销它，然后再在这里做别的事。",
  "error.gitMergeResolveFailed": "无法启动 agent，因此这次合并已被撤回，什么也没有改变：{detail}",
  "git.merge.stopped": "有一个合并因冲突停住了。",
  "git.merge.stoppedFrom": "合并 {branch} 因冲突停住了。",
  "git.merge.resolved": "冲突都解决了。完成合并即可把它记下来。",
  "git.merge.resolve": "让 agent 解决",
  "git.merge.finish": "完成合并",
  "git.merge.abort": "放弃合并",
  "git.merge.resolving": "有 agent 正在解决这次合并：{task}。",
  "git.merge.aborted": "合并已放弃，没有任何内容被合并。",
  "git.merge.recorded": "合并已被记录。",
  "git.branches.conflictsChip": "冲突",
  "git.fetch.nothing": "\u5df2\u83b7\u53d6\u3002\u6ca1\u6709\u65b0\u5185\u5bb9\u3002",
  "git.pull.nothing": "\u5df2\u62c9\u53d6\u3002\u5df2\u7ecf\u662f\u6700\u65b0\u3002",
  "git.fetch.cta": "获取",
  "git.fetch.done": "已获取。{summary}",
  "git.pull.cta": "拉取",
  "git.pull.done": "已拉取。{summary}",
  "error.gitCommitEmpty": "提交需要一条说明。",
  "error.gitTimedOut": "git 没有及时完成，EnvoyDev 已将它停止。仓库可能很大，或者 git 在等待什么。",
  "git.branches.title": "分支",
  "git.branches.aria": "{project} 的分支",
  "git.branches.detachedChip": "无分支",
  "git.branches.detached": "这个仓库的 HEAD 处于分离状态，因此没有当前分支。",
  "git.branches.empty": "这个仓库还没有分支。",
  "git.branches.new": "新建分支",
  "git.branches.name": "分支名",
  "git.branches.create": "创建并切换",
  "git.branches.switched": "已切换到 {branch}。",
  "git.branches.created": "已创建 {branch} 并切换过去。",
  "error.gitMissing": "这台电脑上没有安装 git，EnvoyDev 无法读取这个仓库。请先安装 git 再试。",
  "error.gitNotARepository": "“{path}”不是 git 仓库。只有 git 跟踪的文件夹才有分支。",
  "error.gitBusy": "这个项目里“{title}”正在运行。切换分支之前请先结束或停止它——智能体正在工作时 checkout 会丢失工作。",
  "error.gitFailed": "git 无法完成：{detail}",
  "error.gitBranchInvalid": "“{name}”不能作为分支名。可以使用字母、数字、点、连字符和斜杠，且不能以连字符开头。",
  "error.gitBranchTooLong": "分支名最多 {count} 个字符。",
  "error.gitBranchEmpty": "分支需要一个名字。",
} as const;
