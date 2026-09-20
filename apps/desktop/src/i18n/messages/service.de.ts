/**
 * The **Background service** sentences of the German catalogue, one namespace of it.
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
  "settings.service.title": "Hintergrunddienst",
  "settings.service.detail": "Führt den Daemon als Dienst aus, damit ein Telefon diese Maschine bei geschlossenem Fenster erreicht.",
  "settings.service.state.notInstalled.title": "Aus",
  "settings.service.state.notInstalled.detail": "Ihr Telefon erreicht diese Maschine nur, solange das EnvoyDev-Fenster offen ist.",
  "settings.service.state.running.title": "An, läuft",
  "settings.service.state.running.atLogin": "Der Dienst läuft jetzt und startet beim Anmelden erneut.",
  "settings.service.state.running.notAtLogin": "Der Dienst läuft jetzt, ist aber nicht für den Start beim Anmelden eingerichtet.",
  "settings.service.state.running.plain": "Der Dienst läuft jetzt.",
  "settings.service.state.installedStopped.title": "An, läuft nicht",
  "settings.service.state.installedStopped.atLogin": "Er ist installiert und startet beim Anmelden.",
  "settings.service.state.installedStopped.notAtLogin": "Er ist installiert, aber nicht für den Start beim Anmelden eingerichtet.",
  "settings.service.state.installedStopped.plain": "Er ist installiert, läuft aber gerade nicht.",
  "settings.service.state.failed.title": "Etwas ist schiefgelaufen",
  "settings.service.state.failed.detail": "Der Dienst konnte nicht gestartet werden. Was der Dienstmanager Ihres Systems dazu gesagt hat, steht unten.",
  "settings.service.state.unsupported.title": "Hier nicht verfügbar",
  "settings.service.state.unsupported.detail": "EnvoyDev hat auf diesem System keinen nutzbaren Dienstmanager gefunden. Die App funktioniert weiter, solange das Fenster offen ist.",
  "settings.service.state.unknown.title": "Konnte nicht ermitteln",
  "settings.service.state.unknown.detail": "EnvoyDev konnte den Zustand des Dienstes nicht vom Dienstmanager des Systems lesen.",
  "settings.service.pid": "Prozess {pid}.",
  "settings.service.checking": "Der Dienstmanager Ihres Systems wird gefragt…",
  "settings.service.restarts.one": "Einmal in der letzten Stunde neu gestartet",
  "settings.service.restarts.many": "{count}-mal in der letzten Stunde neu gestartet",
  "settings.service.lastStop.requested": "Letzter Stopp: über die Verbindung angefordert, um {when}",
  "settings.service.lastStop.refused": "Letzter Stopp: Dienst verweigert und beendet, um {when}",
  "settings.service.lastStop.failed": "Letzter Stopp: Start fehlgeschlagen und beendet, um {when}",
  "settings.service.lastStop.signal": "Letzter Stopp: {signal}, um {when}",
  "settings.service.lastStop.signalExit": "Letzter Stopp: {signal} (Exit-Code {code}), um {when}",
  "settings.service.lastStop.crash": "Vor diesem Start gab es keine Stopp-Anforderung — der vorige Dienst wurde beendet oder ist abgestürzt",
  "settings.service.action.turnOn": "Einschalten",
  "settings.service.action.restart": "Neu starten",
  "settings.service.action.stop": "Stoppen",
  "settings.service.action.stop.title": "Den Dienst jetzt stoppen. Da der Dienst installiert ist, startet er bei Ihrer nächsten Anmeldung wieder.",
  "settings.service.action.stop.title.notAtLogin": "Den Dienst jetzt stoppen. Der Dienst ist installiert, aber nicht für den Start bei der Anmeldung eingerichtet.",
  "settings.service.action.stop.title.plain": "Den Dienst jetzt stoppen. Der Dienst bleibt installiert; Ausschalten entfernt ihn.",
  "settings.service.action.turnOff.title": "Den Dienst entfernen, damit er nicht wieder startet.",
  "settings.service.stopVsOff": "Stoppen beendet ihn jetzt; Ausschalten entfernt den Dienst, damit er aus bleibt.",
  "settings.service.action.turnOff": "Ausschalten",
  "settings.service.action.tryAgain": "Erneut versuchen",
  "settings.service.action.refresh": "Aktualisieren",
  "settings.service.busy": "Arbeitet…",
  "settings.service.log.show": "Protokoll anzeigen",
  "settings.service.log.hide": "Protokoll ausblenden",
  "settings.service.log.title": "Daemon-Protokoll",
  "settings.service.log.reading": "Protokoll wird gelesen…",
  "settings.service.log.refresh": "Aktualisieren",
  "settings.service.log.truncated": "Es wird das Ende des Protokolls gezeigt — davor steht mehr.",
  "settings.service.log.empty": "Es wurde noch nichts ins Protokoll geschrieben.",
};
