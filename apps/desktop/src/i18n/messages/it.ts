/**
 * it — the catalogue every string in this window is rendered from.
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

export const it: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "Questo computer",
  "app.rail.show": "Mostra i progetti",
  "app.rail.hide": "Nascondi i progetti",
  "app.rail.toggle": "Mostra o nascondi la barra dei progetti",
  "app.windows.count": "{count} finestre",
  "app.windows.title": "Questo servizio serve tutte le finestre di EnvoyCoder",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "Avvio…",
  "connection.unreachable": "Servizio irraggiungibile",
  "connection.none": "Non connesso",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "Chiudi",

  /* ── the rail ── */
  "sidebar.aria": "Progetti e attività",
  "sidebar.add": "+ Aggiungi progetto",
  "sidebar.add.title": "Registra una cartella come progetto",
  "sidebar.command.title": "Apri la palette dei comandi",
  "sidebar.search.placeholder": "Cerca attività, repository, percorsi",
  "sidebar.search.aria": "Cerca attività, repository e percorsi",
  "sidebar.view.groupBy": "Raggruppa per progetto",
  "sidebar.view.flat": "Un unico elenco, dal più recente",
  "sidebar.view.group": "Raggruppa",
  "sidebar.view.list": "Elenco",
  "sidebar.attention.one": "1 attività ti aspetta",
  "sidebar.attention.many": "{count} attività ti aspettano",
  "sidebar.empty.title": "Ancora nessun progetto",
  "sidebar.empty.body": "Aggiungi una cartella in cui lavori. Le attività che avvii lì compaiono qui, e il progetto ricorda quale agente devono usare.",
  "sidebar.empty.noMatch": "Nessuna corrispondenza con «{query}».",
  "sidebar.empty.cannotLoadTitle": "Impossibile leggere i tuoi progetti",
  "sidebar.empty.cannotLoadBody": "Questo elenco è sconosciuto, non vuoto — EnvoyCoder non ha potuto chiederlo al suo daemon.",
  "sidebar.section.tasks": "Attività",
  "sidebar.project.attention": "Attività che ti aspettano",
  "sidebar.project.agent": "L'agente con cui partono le nuove attività di questo progetto",
  "sidebar.project.settings": "Impostazioni del progetto",
  "sidebar.project.settings.aria": "Impostazioni del progetto {project}",
  "sidebar.project.newTask": "+ Nuova",
  "sidebar.project.newTask.title": "Avvia un'attività in {project}",
  "sidebar.tasks.empty": "Ancora nessuna attività qui.",
  "sidebar.footer.add": "Aggiungi progetto",
  "sidebar.footer.host": "Host: {host}",
  "sidebar.footer.import": "Importa una sessione (non ancora realizzato)",
  "sidebar.footer.import.title": "Importare una sessione dalla cronologia di un altro agente non è ancora realizzato — serve un lettore per ogni agente.",
  "sidebar.footer.help": "Aiuto e assistenza (non ancora realizzato)",
  "sidebar.footer.help.title": "Nessuna schermata di aiuto per ora: il registro delle scorciatoie esiste, la scheda di aiuto no.",
  "sidebar.footer.settings": "Impostazioni",

  /* ── the command palette ── */
  "palette.title": "Palette dei comandi",
  "palette.placeholder": "Digita un comando",
  "palette.search.aria": "Cerca comandi",
  "palette.value": "Valore",
  "palette.selected": "Selezionato",
  "palette.empty": "Nessuna corrispondenza.",
  "palette.group.projects": "Progetti",
  "palette.group.tasks": "Attività",
  "palette.group.machine": "Questo computer",
  "palette.addProject.title": "Aggiungi progetto…",
  "palette.addProject.subtitle": "Registra una cartella in cui lavori",
  "palette.addProject.pickPrompt": "Scegli una cartella di progetto",
  "palette.addProject.noFolder": "Non è stata scelta alcuna cartella, quindi non è stato aggiunto nulla.",
  "palette.addProject.needs": "Quale cartella? Incolla il percorso completo.",
  "palette.addProject.needsPlaceholder": "/Users/you/work/repo",
  "palette.newTask.title": "Nuova attività in {project}",
  "palette.openTask.subtitle": "Apri questa attività",
  "palette.pairPhone.title": "Abbina un telefono",
  "palette.pairPhone.subtitle": "Mostra un codice che l'app mobile può scansionare",
  "palette.pairPhone.notYet": "L'abbinamento di un telefono arriva con la tappa mobile: il servizio non ha ancora un archivio di sessioni, quindi rifiuta i client remoti di proposito.",
  "palette.toggleRail.title": "Mostra o nascondi la barra dei progetti",
  "palette.settings.title": "Apri le impostazioni",
  "palette.settings.subtitle": "Valori predefiniti per le nuove attività e cosa richiede approvazione",
  "palette.noPicker": "Questa finestra non ha una shell da interrogare — incolla invece il percorso della cartella.",
  "palette.pickerFailed": "Impossibile aprire il selettore di cartelle: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder non raggiunge il suo servizio",
  "work.offline.body": "Il servizio è il processo che esegue le tue attività e non risponde. Parte con l'app, quindi di solito si risolve in un momento.",
  "work.loading": "Caricamento dei tuoi progetti…",
  "work.noTask.title": "Nessuna attività aperta",
  "work.noTask.body": "Scegli un'attività a sinistra, oppure avviane una in un progetto. Gli agenti girano su questo computer e, quando la mesh è collegata, anche sui tuoi altri computer.",
  "work.noProjects.title": "Ancora nessun progetto",
  "work.noProjects.body": "Aggiungi una cartella in cui lavori, e EnvoyCoder potrà far girare lì gli agenti.",
  "work.noTask.action": "Avvia un'attività",
  "work.noProjects.action": "Aggiungi un progetto",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "Attività {title}",
  "task.untitled": "Senza titolo",
  "task.meta.agent": "L'agente che esegue questa attività",
  "task.meta.cwd": "Cartella di lavoro: {path}",
  "task.meta.host": "Computer che esegue questa attività",
  "task.cancel": "Ferma",
  "task.cancel.title": "Chiedi all'agente di fermarsi",
  "task.transcript.gap": "Una parte della cronologia di questa attività non è arrivata. Ciò che c'è è in ordine; ricarica per richiedere di nuovo.",
  "task.transcript.empty.title": "Ancora nulla",
  "task.transcript.empty.body": "Chiedi qualcosa e l'agente lavora in {cwd}. Chiamate agli strumenti, approvazioni e diff compaiono qui man mano che accadono.",
  "task.you": "Tu",
  "task.delivered.steered": "si è inserito nel turno",
  "task.delivered.queued": "ha atteso il turno",
  "task.thought.summary": "Come ci ha riflettuto",
  "task.approval.aria": "L'agente attende la tua risposta",
  "task.approval.answered": "Risposto",
  "task.approval.answeredWith": "Risposto: {option}",
  "task.composer.aria": "Scrivi all'agente",
  "task.composer.placeholder.approval": "Rispondi prima alla richiesta qui sopra",
  "task.composer.placeholder.running": "Aggiungi un seguito — «Coda» attende questo turno, «Orienta» vi si inserisce",
  "task.composer.placeholder.idle": "Descrivi l'attività",
  "task.composer.queue": "Coda",
  "task.composer.steer": "Orienta",
  "task.composer.mode.aria": "Come consegnare il messaggio",
  "task.composer.hint": "Invio invia · Maiusc+Invio per una nuova riga",
  "task.empty.suggestion.one": "Spiega cosa fa questo progetto",
  "task.empty.suggestion.two": "Trova e correggi il test che fallisce",
  "task.empty.suggestion.three": "Aggiungi test per l'ultima modifica",
  "task.composer.mode.title": "«Coda» attende il turno in corso; «Orienta» vi si inserisce",
  "task.composer.send": "Invia",
  "task.composer.start": "Avvia",
  "task.composer.submit.blocked": "Rispondi prima alla richiesta qui sopra",
  "task.composer.folder.label": "Cartella",
  "task.composer.folder.aria": "Cambia la cartella di questa attività",
  "task.composer.folder.noPicker": "Questa finestra non ha un selettore di cartelle, quindi la cartella di questa attività non può essere cambiata qui.",
  "task.composer.folder.nextRun": "L'agente sta ancora lavorando in {path}. Una nuova cartella varrà per la prossima esecuzione.",
  "task.composer.agentMode.label": "Modalità",
  "task.composer.agentMode.title": "Che cosa l'agente può fare in questa attività",
  "task.composer.agentMode.unset": "Non impostata",
  "task.composer.agentMode.none": "{agent} non offre modalità selezionabili.",
  "task.composer.agentMode.notWired": "Scegliere una modalità per {agent} non è ancora collegato, quindi il selettore è spento invece di essere ignorato in silenzio.",
  "task.composer.agentMode.unknown": "EnvoyCoder non sa ancora quali modalità offre {agent}, quindi per ora il selettore è spento.",
  "task.composer.agentMode.nextRun": "L'agente mantiene la modalità con cui è partito. La tua scelta varrà per la prossima esecuzione.",
  /* ── the model this task runs on ── */
  "task.composer.model.label": "Modello",
  "task.composer.model.title": "Quale modello usa l'agente per questa attività",
  "task.composer.model.agentDefault": "L'impostazione predefinita dell'agente",
  "task.composer.model.placeholder": "fornitore/modello",
  "task.composer.model.none": "{agent} non accetta un modello.",
  "task.composer.model.notWired": "La scelta del modello per {agent} non è ancora collegata, quindi il campo è disattivato invece di essere ignorato in silenzio.",
  "task.composer.model.unknown": "EnvoyCoder non sa ancora quali modelli offra {agent}, quindi il campo è disattivato per ora.",
  "task.composer.model.freeText": "{agent} pubblica i suoi modelli solo dentro una sessione in corso, quindi qui non c'è nessun elenco da cui scegliere. Scrivine uno come fornitore/modello, usando il nome di fornitore che {agent} stesso adopera — se non ha quel modello, l'esecuzione si ferma con le sue stesse parole invece di usarne un altro in silenzio.",
  "task.composer.model.nextRun": "L'agente mantiene il modello con cui è partito. La tua scelta vale per la prossima esecuzione.",
  "task.composer.model.observed": "Questi sono i modelli che {agent} ha elencato l'ultima volta che EnvoyCoder ha aperto una sessione con lui, il {at}. La prossima volta potrebbe pubblicarne altri.",
  "task.composer.thinking.label": "Ragionamento",
  "task.composer.thinking.title": "Quanto l'agente ragiona prima di rispondere",
  "task.composer.thinking.agentDefault": "Il valore predefinito dell'agente",
  "task.composer.thinking.none": "{agent} non offre un livello di ragionamento.",
  "task.composer.thinking.notSeen": "EnvoyCoder non ha ancora aperto una sessione con {agent}, e {agent} elenca i suoi livelli di ragionamento solo dentro una sessione — quindi non c'è nulla da scegliere finché non ha girato almeno una volta.",
  "task.composer.thinking.notWired": "Scegliere quanto {agent} ragiona non è ancora collegato, quindi il controllo è disattivato invece di essere ignorato in silenzio.",
  "task.composer.thinking.unknown": "EnvoyCoder non sa ancora cosa offre {agent}, quindi il controllo è disattivato per ora.",
  "task.composer.thinking.observed": "Questi sono i livelli di ragionamento che {agent} ha offerto l'ultima volta che EnvoyCoder ha aperto una sessione con lui, il {at}. Sono stati elencati per il modello che stava usando allora, quindi possono cambiare.",
  "task.composer.thinking.nextRun": "L'agente mantiene il livello di ragionamento con cui è partito. La tua scelta vale per la prossima esecuzione.",
  "task.agentMode.default.label": "Predefinita",
  "task.agentMode.default.description": "Fa il lavoro, chiedendo prima di qualsiasi azione distruttiva.",
  "task.agentMode.plan.label": "Piano",
  "task.agentMode.plan.description": "Esamina e proponi un piano. Per ora non cambiare nulla.",
  "task.agentMode.review.label": "Verifica",
  "task.agentMode.review.description": "Verifica e riferisci. Non cambiare nulla.",

  /* ── a status, in the words a user reads ── */
  "status.queued": "In attesa di avvio",
  "status.running": "In esecuzione",
  "status.needsAttention": "Attende la tua risposta",
  "status.idle": "Inattivo",
  "status.done": "Completato",
  "status.failed": "Fermato con un errore",
  "status.cancelled": "Fermato",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "Completato.",
  "run.end.cancelled": "Fermato.",
  "run.end.failed": "Fermato prima di finire.",
  "run.end.other": "Concluso.",
  "run.diff.one": "1 file modificato.",
  "run.diff.many": "{count} file modificati.",
  "run.context": "Contesto pieno al {percent}%.",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "Mesh connessa — {count} macchine raggiungibili",
  "mesh.attached.none": "Mesh connessa — nessun'altra macchina raggiungibile per ora",
  "mesh.noNode": "EnvoyMesh non è in esecuzione — le attività restano su questo computer",
  "mesh.refused": "EnvoyMesh ha rifiutato una sessione a EnvoyCoder — le attività restano su questo computer",
  "mesh.peers": "{count} peer",
  "mesh.scope.title": "Ambito di sessione {scope}",
  "mesh.agentsHere": "Gli agenti girano su questo computer",

  /* ── settings ── */
  "settings.title": "Impostazioni",
  "settings.close": "Chiudi",
  "settings.stateDir": "Dati in {path}",
  "settings.noDaemon": "Nessun servizio",
  "settings.daemon": "Servizio {version}",
  "settings.daemon.title": "Il servizio a cui è collegata questa finestra",
  "settings.language.title": "Lingua",
  "settings.language.detail": "La lingua di questa finestra — ogni etichetta, avviso ed errore, compresi quelli che il servizio restituisce. Viene salvata con le tue impostazioni su questo computer, quindi ti segue sulle altre finestre e sul telefono.",
  "settings.language.aria": "Lingua",
  "settings.language.system": "Come questo computer",
  "settings.defaultHarness.title": "L'agente con cui partono le nuove attività",
  "settings.defaultHarness.detail": "Un progetto può sostituirlo; questo vale quando non lo fa.",
  "settings.needsInstalling": "(da installare)",
  "settings.approvals.title": "Chiedi prima di qualsiasi azione distruttiva",
  "settings.approvals.detail": "Gli agenti si fermano e ti aspettano invece di sovrascrivere file. Disattivarlo significa che un'attività può modificare il tuo albero di lavoro senza chiedere.",
  "settings.remoteRuns.title": "Condividi gli agenti di questo computer con i tuoi altri computer",
  "settings.remoteRuns.detail": "Disattivato per impostazione predefinita. Quando è attivo, un'attività proveniente da un altro tuo computer può girare qui, in una tua cartella.",
  "settings.transcripts.title": "Conserva le trascrizioni dopo la fine di un'attività",
  "settings.transcripts.detail": "Il resoconto di ciò che un agente ha fatto, conservato su questo computer. Disattivarlo risparmia spazio e rende «cosa ha cambiato?» senza risposta in seguito.",
  "settings.agents.heading": "Agenti su questo computer",
  "settings.agents.note": "Ciò che ogni agente sa fare davvero decide cosa offre EnvoyCoder. A un agente a cui non si può chiedere il permesso non viene mostrato un dialogo di approvazione che ignorerebbe.",
  "settings.agents.empty": "L'elenco degli agenti non è ancora arrivato.",
  "settings.agent.notInstalled": "Non installato",
  "settings.agent.unknown": "Sconosciuto",
  "settings.agent.ready": "Pronto",
  "settings.agent.noApprovals": "Senza approvazioni",
  "settings.agent.noApprovals.title": "Questo agente non chiede mai prima di agire",
  "settings.agent.noCancel": "Non annullabile",
  "settings.agent.noCancel.title": "L'unico modo per fermare questo agente è terminare il suo processo",
  "settings.notes.heading": "Cose utili da sapere",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path} non è una cartella su questo computer. Scegli una cartella che esista — EnvoyCoder ci fa girare gli agenti, quindi il percorso deve essere reale.",
  "error.createTask.notDirectory": "{path} non è una cartella su questo computer, quindi non c'è dove eseguire l'agente. Era la cartella di lavoro di «{title}».",
  "error.updateTask.notDirectory": "{path} non è una cartella su questo computer, quindi l'agente non avrebbe dove essere eseguito. La cartella dell'attività resta invariata.",
  "error.agentModeUnsupported": "{harness} non può essere messo in una modalità tramite il protocollo che EnvoyCoder usa con lui, quindi questa esecuzione non è partita. Lascia la modalità non impostata per eseguire {harness} con la sua predefinita.",
  "error.agentModeUnknown": "{harness} non offre una modalità chiamata «{mode}», quindi questa esecuzione non è partita. Scegli una delle sue modalità e riprova.",
  /* ── the model refusals ── */
  "error.modelUnsupported": "{harness} non accetta un modello, quindi questa esecuzione non è partita. Cancella il modello e riavvia: {harness} partirà con la propria impostazione predefinita.",
  "error.modelUnknown": "{harness} non pubblica un modello chiamato «{model}», quindi EnvoyCoder non può dire a quale fornitore appartiene e l'esecuzione non è partita. Scegli uno dei modelli che {harness} pubblica.",
  "error.modelNotProviderQualified": "{harness} vuole un modello scritto come fornitore/modello — il nome del fornitore, una barra, poi il modello — e «{model}» non indica entrambi, quindi l'esecuzione non è partita.",
  "error.thinkingUnsupported": "{harness} non può ricevere un livello di ragionamento tramite il protocollo che EnvoyCoder parla con lui, quindi l'esecuzione non è partita. Lascia il livello di ragionamento non impostato per far decidere {harness} da sé.",
  "error.projectNotFound": "Non esiste un progetto chiamato «{id}» su questo computer. Potrebbe essere stato rimosso da un'altra finestra.",
  "error.taskNotFound": "Non esiste un'attività chiamata «{id}» su questo computer. Potrebbe essere stata rimossa da un'altra finestra.",
  "error.runNotFound": "Non esiste un'esecuzione chiamata «{runId}». Potrebbe essere stata avviata da un servizio riavviato nel frattempo.",
  "error.taskForRunMissing": "Non esiste un'attività chiamata «{taskId}», quindi non c'è dove eseguire un agente.",
  "error.taskAlreadyRunning": "«{task}» è già in esecuzione. Mandale invece un messaggio — avviare un secondo agente nella stessa cartella è il modo in cui due di loro finiscono per modificare lo stesso file.",
  "error.runFinished": "Quell'esecuzione è già finita, quindi non c'è nulla a cui inviare. Avvia invece una nuova attività.",
  "error.approvalPending": "L'agente attende una risposta prima di poter proseguire. Rispondi prima a quella — un messaggio inviato ora resterebbe in attesa dietro.",
  "error.noRunRuntime": "Questo servizio è stato avviato senza un runtime per agenti, quindi non può eseguire attività.",
  "error.harnessMissing": "{harness} non è installato su questo computer. Installalo, poi avvia di nuovo l'attività.",
  "error.harnessUnsupported": "{harness} parla un protocollo che EnvoyCoder non sa ancora pilotare (questo adattatore pilota solo agenti ACP). Oggi funzionano Envoy Harness e DeepSeek Harness; {harness} ha bisogno di un proprio adattatore.",
  "error.notConnected": "EnvoyCoder non è ancora connesso al suo servizio.",
  "error.notConnectedChange": "EnvoyCoder non è connesso al suo servizio, quindi quella modifica non è stata salvata.",
  "error.connectionClosed": "La connessione è stata chiusa.",
  "error.daemonClosedConnection": "Il servizio ha chiuso la connessione.",
  "error.daemonTooOld":
    "Il daemon con cui parla questa finestra è una versione precedente: non conosce {method}. Riavvia EnvoyCoder in modo che la finestra e il suo daemon siano la stessa versione, poi riprova.",
  "error.notOurDaemon.product": "Qualcosa risponde sulla porta del servizio, ma dichiara di essere «{product}». EnvoyCoder non vi si è connesso.",
  "error.notOurDaemon.instance": "Il servizio sulla porta {port} non è quello per cui è stata avviata questa finestra. Un altro servizio EnvoyCoder potrebbe averlo sostituito — riapri la finestra.",
  "error.shellEndpointFailed": "La finestra di EnvoyCoder non ha potuto chiedere alla shell dove sia il servizio. Ricompila l'app desktop (l'elenco dei permessi della shell è obsoleto).",
  "error.shellEndpointMissing": "La shell di EnvoyCoder non ha indicato dove sia il suo servizio. Senza questo, la finestra non può connettersi.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder non ha potuto leggere {name}, quindi l'ha spostato in {movedTo} e ha ricominciato quell'elenco da vuoto. ({reason})",
  "note.quarantined.left": "EnvoyCoder non ha potuto leggere {name} né spostarlo, quindi l'ha lasciato intatto e ha ricominciato quell'elenco da vuoto. ({reason})",
  "note.skipped": "{file}: {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "Consentire all'agente di eseguire «{tool}»?",
  "approval.question.generic": "Consentire all'agente di proseguire?",
  "approval.detail": "Si è fermato prima di questo passo e non proseguirà finché non rispondi. Rispondere a questa singola richiesta non autorizza nient'altro.",
};
