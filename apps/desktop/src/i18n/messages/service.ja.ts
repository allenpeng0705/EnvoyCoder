/**
 * The **Background service** sentences of the Japanese catalogue, one namespace of it.
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
  "settings.service.title": "バックグラウンドサービス",
  "settings.service.detail": "デーモンをサービスとして実行し、ウィンドウを閉じていてもスマートフォンからこのマシンに接続できるようにします。",
  "settings.service.state.notInstalled.title": "オフ",
  "settings.service.state.notInstalled.detail": "EnvoyDev のウィンドウを開いている間だけ、スマートフォンからこのマシンに接続できます。",
  "settings.service.state.running.title": "オン、実行中",
  "settings.service.state.running.atLogin": "サービスは実行中で、ログイン時に再び起動します。",
  "settings.service.state.running.notAtLogin": "サービスは実行中ですが、ログイン時に起動する設定にはなっていません。",
  "settings.service.state.running.plain": "サービスは実行中です。",
  "settings.service.state.installedStopped.title": "オン、停止中",
  "settings.service.state.installedStopped.atLogin": "インストール済みで、ログイン時に起動します。",
  "settings.service.state.installedStopped.notAtLogin": "インストール済みですが、ログイン時に起動する設定にはなっていません。",
  "settings.service.state.installedStopped.plain": "インストール済みですが、現在は実行されていません。",
  "settings.service.state.failed.title": "問題が発生しました",
  "settings.service.state.failed.detail": "サービスを開始できませんでした。システムのサービスマネージャーの応答を下に示します。",
  "settings.service.state.unsupported.title": "この環境では利用できません",
  "settings.service.state.unsupported.detail": "EnvoyDev はこのシステムで利用できるサービスマネージャーを見つけられませんでした。ウィンドウを開いている間はアプリをそのまま使えます。",
  "settings.service.state.unknown.title": "判別できませんでした",
  "settings.service.state.unknown.detail": "システムのサービスマネージャーからサービスの状態を読み取れませんでした。",
  "settings.service.pid": "プロセス {pid}。",
  "settings.service.checking": "システムのサービスマネージャーに問い合わせています…",
  "settings.service.restarts.one": "過去 1 時間に 1 回再起動しました",
  "settings.service.restarts.many": "過去 1 時間に {count} 回再起動しました",
  "settings.service.lastStop.requested": "前回の停止: 接続経由で要求されました（{when}）",
  "settings.service.lastStop.refused": "前回の停止: サービスを拒否して終了しました（{when}）",
  "settings.service.lastStop.failed": "前回の停止: サービスの提供に失敗して終了しました（{when}）",
  "settings.service.lastStop.signal": "前回の停止: {signal}（{when}）",
  "settings.service.lastStop.signalExit": "前回の停止: {signal}（終了コード {code}、{when}）",
  "settings.service.lastStop.crash": "今回の起動の前に停止要求がありません — 前回のデーモンは強制終了またはクラッシュしました",
  "settings.service.action.turnOn": "オンにする",
  "settings.service.action.restart": "再起動",
  "settings.service.action.stop": "停止",
  "settings.service.action.stop.title": "デーモンを今すぐ停止します。サービスはインストール済みなので、次回ログイン時に再起動します。",
  "settings.service.action.stop.title.notAtLogin": "デーモンを今すぐ停止します。サービスはインストール済みですが、ログイン時に起動する設定にはなっていません。",
  "settings.service.action.stop.title.plain": "デーモンを今すぐ停止します。サービスはインストールされたままです。「オフにする」で削除できます。",
  "settings.service.action.turnOff.title": "サービスを削除し、デーモンが再起動しないようにします。",
  "settings.service.stopVsOff": "「停止」は今すぐ終了します。「オフにする」はサービスを削除して再起動しないようにします。",
  "settings.service.action.turnOff": "オフにする",
  "settings.service.action.tryAgain": "再試行",
  "settings.service.action.refresh": "更新",
  "settings.service.busy": "処理中…",
  "settings.service.log.show": "ログを表示",
  "settings.service.log.hide": "ログを隠す",
  "settings.service.log.title": "デーモンのログ",
  "settings.service.log.reading": "ログを読み込んでいます…",
  "settings.service.log.refresh": "更新",
  "settings.service.log.truncated": "ログの末尾を表示しています — この前に続きがあります。",
  "settings.service.log.empty": "ログにはまだ何も書き込まれていません。",
};
