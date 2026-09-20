/**
 * The **Background service** sentences of the Korean catalogue, one namespace of it.
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
  "settings.service.title": "백그라운드 서비스",
  "settings.service.detail": "데몬을 서비스로 실행하여 창을 닫아도 휴대폰이 이 컴퓨터에 접속할 수 있게 합니다.",
  "settings.service.state.notInstalled.title": "꺼짐",
  "settings.service.state.notInstalled.detail": "EnvoyDev 창을 열어 둔 동안에만 휴대폰에서 이 컴퓨터에 접속할 수 있습니다.",
  "settings.service.state.running.title": "켜짐, 실행 중",
  "settings.service.state.running.atLogin": "서비스가 실행 중이며 로그인할 때 다시 시작됩니다.",
  "settings.service.state.running.notAtLogin": "서비스가 실행 중이지만 로그인할 때 시작하도록 설정되어 있지 않습니다.",
  "settings.service.state.running.plain": "서비스가 실행 중입니다.",
  "settings.service.state.installedStopped.title": "켜짐, 중지됨",
  "settings.service.state.installedStopped.atLogin": "설치되어 있으며 로그인할 때 시작됩니다.",
  "settings.service.state.installedStopped.notAtLogin": "설치되어 있지만 로그인할 때 시작하도록 설정되어 있지 않습니다.",
  "settings.service.state.installedStopped.plain": "설치되어 있지만 지금은 실행되고 있지 않습니다.",
  "settings.service.state.failed.title": "문제가 발생했습니다",
  "settings.service.state.failed.detail": "서비스를 시작하지 못했습니다. 시스템 서비스 관리자의 응답은 아래와 같습니다.",
  "settings.service.state.unsupported.title": "여기서는 사용할 수 없음",
  "settings.service.state.unsupported.detail": "EnvoyDev가 이 시스템에서 사용할 수 있는 서비스 관리자를 찾지 못했습니다. 창을 열어 둔 동안에는 앱이 계속 작동합니다.",
  "settings.service.state.unknown.title": "확인할 수 없음",
  "settings.service.state.unknown.detail": "시스템 서비스 관리자에서 서비스 상태를 읽지 못했습니다.",
  "settings.service.pid": "프로세스 {pid}.",
  "settings.service.checking": "시스템 서비스 관리자에 확인하는 중…",
  "settings.service.restarts.one": "지난 한 시간 동안 한 번 다시 시작했습니다",
  "settings.service.restarts.many": "지난 한 시간 동안 {count}번 다시 시작했습니다",
  "settings.service.lastStop.requested": "마지막 중지: 연결을 통해 요청됨, {when}",
  "settings.service.lastStop.refused": "마지막 중지: 서비스를 거부하고 종료됨, {when}",
  "settings.service.lastStop.failed": "마지막 중지: 서비스를 제공하지 못하고 종료됨, {when}",
  "settings.service.lastStop.signal": "마지막 중지: {signal}, {when}",
  "settings.service.lastStop.signalExit": "마지막 중지: {signal} (종료 코드 {code}), {when}",
  "settings.service.lastStop.crash": "이번 시작 전에 중지 요청이 없었습니다 — 이전 데몬이 강제 종료되었거나 충돌했습니다",
  "settings.service.action.turnOn": "켜기",
  "settings.service.action.restart": "다시 시작",
  "settings.service.action.stop": "중지",
  "settings.service.action.stop.title": "지금 데몬을 중지합니다. 서비스가 설치되어 있으므로 다음 로그인 때 다시 시작됩니다.",
  "settings.service.action.stop.title.notAtLogin": "지금 데몬을 중지합니다. 서비스는 설치되어 있지만 로그인할 때 시작하도록 설정되어 있지 않습니다.",
  "settings.service.action.stop.title.plain": "지금 데몬을 중지합니다. 서비스는 설치된 상태로 남습니다. 끄기로 제거할 수 있습니다.",
  "settings.service.action.turnOff.title": "서비스를 제거하여 데몬이 다시 시작되지 않게 합니다.",
  "settings.service.stopVsOff": "중지는 지금 끝냅니다. 끄기는 서비스를 제거하여 계속 꺼진 상태로 둡니다.",
  "settings.service.action.turnOff": "끄기",
  "settings.service.action.tryAgain": "다시 시도",
  "settings.service.action.refresh": "새로 고침",
  "settings.service.busy": "처리 중…",
};
