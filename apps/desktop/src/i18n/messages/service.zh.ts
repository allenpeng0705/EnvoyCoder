/**
 * The **Background service** sentences of the Chinese (Simplified) catalogue, one namespace of it.
 *
 * ## Why a namespace has its own file
 *
 * The catalogues reached the family's 800-line hard cap (`scripts/check-module-size.mjs`), and its own
 * advice is to split the key namespaces rather than exempt new growth. Git moved first; the service row is
 * the next namespace and the one this slice grew — six states with their login variants, five presses, the
 * Stop-versus-Turn-off sentence, and the daemon's own restart/stop evidence. The base catalogue spreads it
 * back into place with `...service`.
 *
 * A fragment is a plain object of the same sentences the base file used to carry — typed `Catalogue`, so
 * a key English does not have is a compile error here as well as a test failure. `MessageKey` is still
 * `keyof typeof en`, and `i18n.test.ts` still proves the seven languages agree key for key.
 */

import type { Catalogue } from "../translate.js";

export const service: Catalogue = {
  "settings.service.title": "后台服务",
  "settings.service.detail": "以服务方式运行守护进程，这样关闭窗口后手机仍能访问这台机器。",
  "settings.service.state.notInstalled.title": "已关闭",
  "settings.service.state.notInstalled.detail": "只有在 EnvoyDev 窗口打开时，手机才能访问这台机器。",
  "settings.service.state.running.title": "已开启，运行中",
  "settings.service.state.running.atLogin": "服务正在运行，并会在您登录时再次启动。",
  "settings.service.state.running.notAtLogin": "服务正在运行，但未设置为在您登录时启动。",
  "settings.service.state.running.plain": "服务正在运行。",
  "settings.service.state.installedStopped.title": "已开启，未运行",
  "settings.service.state.installedStopped.atLogin": "服务已安装，并会在您登录时启动。",
  "settings.service.state.installedStopped.notAtLogin": "服务已安装，但未设置为在您登录时启动。",
  "settings.service.state.installedStopped.plain": "服务已安装，但目前没有运行。",
  "settings.service.state.failed.title": "出了问题",
  "settings.service.state.failed.detail": "服务无法启动。下方是系统服务管理器的说明。",
  "settings.service.state.unsupported.title": "此系统不可用",
  "settings.service.state.unsupported.detail": "EnvoyDev 在此系统上找不到可用的服务管理器。只要窗口打开，应用仍可正常使用。",
  "settings.service.state.unknown.title": "无法确定",
  "settings.service.state.unknown.detail": "EnvoyDev 无法从系统服务管理器读取服务状态。",
  "settings.service.pid": "进程 {pid}。",
  "settings.service.checking": "正在询问系统服务管理器…",
  "settings.service.restarts.one": "过去一小时内重启过 1 次",
  "settings.service.restarts.many": "过去一小时内重启过 {count} 次",
  "settings.service.lastStop.requested": "上次停止：通过连接请求，{when}",
  "settings.service.lastStop.refused": "上次停止：拒绝提供服务并退出，{when}",
  "settings.service.lastStop.failed": "上次停止：无法提供服务并退出，{when}",
  "settings.service.lastStop.signal": "上次停止：{signal}，{when}",
  "settings.service.lastStop.signalExit": "上次停止：{signal}（退出码 {code}），{when}",
  "settings.service.lastStop.crash": "本次启动前没有停止请求 — 上一个守护进程被强制结束或崩溃了",
  "settings.service.action.turnOn": "开启",
  "settings.service.action.restart": "重启",
  "settings.service.action.stop": "停止",
  "settings.service.action.stop.title": "立即停止守护进程。由于服务已安装，它会在您下次登录时重新启动。",
  "settings.service.action.stop.title.notAtLogin": "立即停止守护进程。服务已安装，但未设置为在您登录时启动。",
  "settings.service.action.stop.title.plain": "立即停止守护进程。服务仍保持安装；“关闭”会将其移除。",
  "settings.service.action.turnOff.title": "移除服务，使守护进程不再启动。",
  "settings.service.stopVsOff": "“停止”会立即结束它；“关闭”会移除服务，使其不再启动。",
  "settings.service.action.turnOff": "关闭",
  "settings.service.action.tryAgain": "重试",
  "settings.service.action.refresh": "刷新",
  "settings.service.busy": "处理中…",
  "settings.service.log.show": "查看日志",
  "settings.service.log.hide": "隐藏日志",
  "settings.service.log.title": "守护进程日志",
  "settings.service.log.reading": "正在读取日志…",
  "settings.service.log.refresh": "刷新",
  "settings.service.log.truncated": "显示日志的末尾 — 前面还有更多内容。",
  "settings.service.log.empty": "日志中还没有写入任何内容。",
};
