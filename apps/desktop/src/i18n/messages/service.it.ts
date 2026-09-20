/**
 * The **Background service** sentences of the Italian catalogue, one namespace of it.
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
  "settings.service.title": "Servizio in background",
  "settings.service.detail": "Esegue il daemon come servizio, così un telefono raggiunge questa macchina a finestra chiusa.",
  "settings.service.state.notInstalled.title": "Spento",
  "settings.service.state.notInstalled.detail": "Il telefono può raggiungere questa macchina solo mentre la finestra di EnvoyDev è aperta.",
  "settings.service.state.running.title": "Acceso, in esecuzione",
  "settings.service.state.running.atLogin": "Il servizio è in esecuzione e riparte quando accedi.",
  "settings.service.state.running.notAtLogin": "Il servizio è in esecuzione, ma non è impostato per partire quando accedi.",
  "settings.service.state.running.plain": "Il servizio è in esecuzione.",
  "settings.service.state.installedStopped.title": "Acceso, non in esecuzione",
  "settings.service.state.installedStopped.atLogin": "È installato e parte quando accedi.",
  "settings.service.state.installedStopped.notAtLogin": "È installato, ma non è impostato per partire quando accedi.",
  "settings.service.state.installedStopped.plain": "È installato ma al momento non è in esecuzione.",
  "settings.service.state.failed.title": "Qualcosa è andato storto",
  "settings.service.state.failed.detail": "Non è stato possibile avviare il servizio. Qui sotto c'è la risposta del gestore di servizi del sistema.",
  "settings.service.state.unsupported.title": "Non disponibile qui",
  "settings.service.state.unsupported.detail": "EnvoyDev non ha trovato un gestore di servizi utilizzabile su questo sistema. L'app funziona comunque mentre la finestra è aperta.",
  "settings.service.state.unknown.title": "Impossibile determinarlo",
  "settings.service.state.unknown.detail": "EnvoyDev non ha potuto leggere lo stato del servizio dal gestore di servizi del sistema.",
  "settings.service.pid": "Processo {pid}.",
  "settings.service.checking": "Interrogazione del gestore di servizi del sistema…",
  "settings.service.restarts.one": "Riavviato una volta nell'ultima ora",
  "settings.service.restarts.many": "Riavviato {count} volte nell'ultima ora",
  "settings.service.lastStop.requested": "Ultimo arresto: richiesto tramite la connessione, alle {when}",
  "settings.service.lastStop.refused": "Ultimo arresto: servizio rifiutato e uscita, alle {when}",
  "settings.service.lastStop.failed": "Ultimo arresto: avvio non riuscito e uscita, alle {when}",
  "settings.service.lastStop.signal": "Ultimo arresto: {signal}, alle {when}",
  "settings.service.lastStop.signalExit": "Ultimo arresto: {signal} (codice di uscita {code}), alle {when}",
  "settings.service.lastStop.crash": "Nessuna richiesta di arresto ha preceduto questo avvio — il demone precedente è stato terminato o è andato in crash",
  "settings.service.action.turnOn": "Attiva",
  "settings.service.action.restart": "Riavvia",
  "settings.service.action.stop": "Arresta",
  "settings.service.action.stop.title": "Arresta il demone ora. Poiché il servizio è installato, ripartirà al prossimo accesso.",
  "settings.service.action.stop.title.notAtLogin": "Arresta il demone ora. Il servizio è installato, ma non è impostato per partire quando accedi.",
  "settings.service.action.stop.title.plain": "Arresta il demone ora. Il servizio resta installato; Disattiva lo rimuove.",
  "settings.service.action.turnOff.title": "Rimuovi il servizio, così il demone non riparte.",
  "settings.service.stopVsOff": "Arresta lo termina ora; Disattiva rimuove il servizio così resta spento.",
  "settings.service.action.turnOff": "Disattiva",
  "settings.service.action.tryAgain": "Riprova",
  "settings.service.action.refresh": "Aggiorna",
  "settings.service.busy": "In corso…",
  "settings.service.log.show": "Mostra il registro",
  "settings.service.log.hide": "Nascondi il registro",
  "settings.service.log.title": "Registro del demone",
  "settings.service.log.reading": "Lettura del registro…",
  "settings.service.log.refresh": "Aggiorna",
  "settings.service.log.truncated": "Viene mostrata la fine del registro — prima c'è dell'altro.",
  "settings.service.log.empty": "Non è ancora stato scritto nulla nel registro.",
};
