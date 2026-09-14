/**
 * de — the catalogue every string in this window is rendered from.
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

export const de: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "Dieser Computer",
  "app.rail.show": "Projekte einblenden",
  "app.rail.hide": "Projekte ausblenden",
  "app.rail.toggle": "Projektleiste ein- oder ausblenden",
  "app.windows.count": "{count} Fenster",
  "app.windows.title": "Dieser Dienst versorgt alle EnvoyCoder-Fenster",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "Startet…",
  "connection.unreachable": "Dienst nicht erreichbar",
  "connection.none": "Nicht verbunden",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "Ausblenden",

  /* ── the rail ── */
  "sidebar.aria": "Projekte und Aufgaben",
  "sidebar.add": "+ Projekt hinzufügen",
  "sidebar.add.title": "Ein Verzeichnis als Projekt registrieren",
  "sidebar.command.title": "Command Center öffnen",
  "sidebar.search.placeholder": "Aufgaben, Repos, Pfade durchsuchen",
  "sidebar.search.aria": "Aufgaben, Repositories und Pfade durchsuchen",
  "sidebar.view.groupBy": "Nach Projekt gruppieren",
  "sidebar.view.flat": "Eine flache Liste, neueste zuerst",
  "sidebar.view.group": "Gruppieren",
  "sidebar.view.list": "Liste",
  "sidebar.attention.one": "1 Aufgabe braucht dich",
  "sidebar.attention.many": "{count} Aufgaben brauchen dich",
  "sidebar.empty.title": "Noch keine Projekte",
  "sidebar.empty.body": "Füge ein Verzeichnis hinzu, in dem du arbeitest. Aufgaben, die du darin startest, erscheinen hier, und das Projekt merkt sich, welchen Agenten sie verwenden sollen.",
  "sidebar.empty.noMatch": "Nichts passt zu „{query}“.",
  "sidebar.empty.cannotLoadTitle": "Deine Projekte konnten nicht gelesen werden",
  "sidebar.empty.cannotLoadBody": "Diese Liste ist unbekannt, nicht leer — EnvoyCoder konnte den Daemon nicht danach fragen.",
  "sidebar.section.tasks": "Aufgaben",
  "sidebar.project.attention": "Aufgaben, die auf dich warten",
  "sidebar.project.agent": "Der Agent, mit dem neue Aufgaben in diesem Projekt starten",
  "sidebar.project.settings": "Projekteinstellungen",
  "sidebar.project.settings.aria": "Projekteinstellungen für {project}",
  "sidebar.project.newTask": "+ Neu",
  "sidebar.project.newTask.title": "Eine Aufgabe in {project} starten",
  "sidebar.tasks.empty": "Hier gibt es noch keine Aufgaben.",
  "sidebar.footer.add": "Projekt hinzufügen",
  "sidebar.footer.host": "Host: {host}",
  "sidebar.footer.import": "Sitzung importieren (noch nicht gebaut)",
  "sidebar.footer.import.title": "Eine Sitzung aus dem Verlauf eines anderen Agenten zu importieren ist noch nicht gebaut — dafür braucht es einen Leser pro Agent.",
  "sidebar.footer.help": "Hilfe und Support (noch nicht gebaut)",
  "sidebar.footer.help.title": "Noch keine Hilfe-Oberfläche: Die Tastenkürzel-Registry existiert, das Hilfe-Blatt nicht.",
  "sidebar.footer.settings": "Einstellungen",

  /* ── the command palette ── */
  "palette.title": "Befehlspalette",
  "palette.placeholder": "Befehl eingeben",
  "palette.search.aria": "Befehle durchsuchen",
  "palette.value": "Wert",
  "palette.selected": "Ausgewählt",
  "palette.empty": "Dazu passt nichts.",
  "palette.group.projects": "Projekte",
  "palette.group.tasks": "Aufgaben",
  "palette.group.machine": "Dieser Computer",
  "palette.addProject.title": "Projekt hinzufügen…",
  "palette.addProject.subtitle": "Ein Verzeichnis registrieren, in dem du arbeitest",
  "palette.addProject.pickPrompt": "Projektordner wählen",
  "palette.addProject.noFolder": "Es wurde kein Ordner gewählt, also wurde nichts hinzugefügt.",
  "palette.addProject.needs": "Welcher Ordner? Füge den vollständigen Pfad ein.",
  "palette.addProject.needsPlaceholder": "/Users/you/work/repo",
  "palette.newTask.title": "Neue Aufgabe in {project}",
  "palette.openTask.subtitle": "Diese Aufgabe öffnen",
  "palette.pairPhone.title": "Telefon koppeln",
  "palette.pairPhone.subtitle": "Einen Code zeigen, den die mobile App scannen kann",
  "palette.pairPhone.notYet": "Das Koppeln eines Telefons kommt mit dem mobilen Meilenstein: Der Dienst hat noch keinen Sitzungsspeicher, deshalb lehnt er entfernte Clients bewusst ab.",
  "palette.toggleRail.title": "Projektleiste ein- oder ausblenden",
  "palette.settings.title": "Einstellungen öffnen",
  "palette.settings.subtitle": "Voreinstellungen für neue Aufgaben und was genehmigt werden muss",
  "palette.noPicker": "Dieses Fenster hat keine Shell, die es fragen könnte — füge den Ordnerpfad stattdessen ein.",
  "palette.pickerFailed": "Der Ordnerdialog konnte nicht geöffnet werden: {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder erreicht seinen Dienst nicht",
  "work.offline.body": "Der Dienst ist der Prozess, der deine Aufgaben ausführt, und er antwortet nicht. Er startet mit der App, deshalb löst sich das meist in einem Moment von selbst.",
  "work.loading": "Deine Projekte werden geladen…",
  "work.noTask.title": "Keine Aufgabe geöffnet",
  "work.noTask.body": "Wähle links eine Aufgabe oder starte eine in einem Projekt. Agenten laufen auf diesem Computer und, wenn das Mesh verbunden ist, auch auf deinen anderen Computern.",
  "work.noProjects.title": "Noch keine Projekte",
  "work.noProjects.body": "Füge ein Verzeichnis hinzu, in dem du arbeitest, dann kann EnvoyCoder dort Agenten laufen lassen.",
  "work.noTask.action": "Aufgabe starten",
  "work.noProjects.action": "Projekt hinzufügen",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "Aufgabe {title}",
  "task.untitled": "Ohne Titel",
  "task.meta.agent": "Der Agent, der diese Aufgabe ausführt",
  "task.meta.cwd": "Arbeitsverzeichnis: {path}",
  "task.meta.host": "Computer, auf dem diese Aufgabe läuft",
  "task.cancel": "Stoppen",
  "task.cancel.title": "Den Agenten bitten zu stoppen",
  "task.transcript.gap": "Ein Teil des Verlaufs dieser Aufgabe ist nicht angekommen. Was hier steht, ist in der richtigen Reihenfolge; lade neu, um erneut zu fragen.",
  "task.transcript.empty.title": "Noch nichts",
  "task.transcript.empty.body": "Frag nach etwas, und der Agent arbeitet in {cwd}. Tool-Aufrufe, Genehmigungen und Diffs erscheinen hier, sobald sie passieren.",
  "task.you": "Du",
  "task.delivered.steered": "ist in den Durchgang gesprungen",
  "task.delivered.queued": "wartet auf den Durchgang",
  "task.thought.summary": "Wie es darüber nachgedacht hat",
  "task.approval.aria": "Der Agent braucht deine Antwort",
  "task.approval.answered": "Beantwortet",
  "task.approval.answeredWith": "Beantwortet: {option}",
  "task.composer.aria": "Dem Agenten schreiben",
  "task.composer.placeholder.approval": "Beantworte zuerst die Anfrage oben",
  "task.composer.placeholder.running": "Ergänze etwas — „Warteschlange“ wartet auf diesen Durchgang, „Lenken“ springt hinein",
  "task.composer.placeholder.idle": "Beschreibe die Aufgabe",
  "task.composer.queue": "Warteschlange",
  "task.composer.steer": "Lenken",
  "task.composer.mode.aria": "Wie die Nachricht zugestellt wird",
  "task.composer.hint": "Enter sendet · Shift+Enter für eine neue Zeile",
  "task.empty.suggestion.one": "Erkläre, was dieses Projekt macht",
  "task.empty.suggestion.two": "Finde und behebe den fehlschlagenden Test",
  "task.empty.suggestion.three": "Ergänze Tests für die letzte Änderung",
  "task.composer.mode.title": "„Warteschlange“ wartet auf den laufenden Durchgang; „Lenken“ springt hinein",
  "task.composer.send": "Senden",
  "task.composer.start": "Starten",
  "task.composer.submit.blocked": "Beantworte zuerst die Anfrage oben",
  "task.composer.folder.label": "Ordner",
  "task.composer.folder.aria": "Den Ordner dieser Aufgabe ändern",
  "task.composer.folder.noPicker": "Dieses Fenster hat keine Ordnerauswahl, deshalb lässt sich der Ordner dieser Aufgabe hier nicht ändern.",
  "task.composer.folder.nextRun": "Der Agent arbeitet noch in {path}. Ein neuer Ordner gilt für den nächsten Lauf.",
  "task.composer.agentMode.label": "Modus",
  "task.composer.agentMode.title": "Was der Agent in dieser Aufgabe tun darf",
  "task.composer.agentMode.unset": "Nicht gesetzt",
  "task.composer.agentMode.none": "{agent} bietet keine auswählbaren Modi.",
  "task.composer.agentMode.notWired": "Einen Modus für {agent} zu wählen ist noch nicht angeschlossen, deshalb ist die Auswahl aus statt still ignoriert zu werden.",
  "task.composer.agentMode.unknown": "EnvoyCoder weiß noch nicht, welche Modi {agent} bietet, deshalb ist die Auswahl vorerst aus.",
  "task.composer.agentMode.nextRun": "Der Agent behält den Modus, mit dem er gestartet ist. Deine Wahl gilt für den nächsten Lauf.",
  "task.agentMode.default.label": "Standard",
  "task.agentMode.default.description": "Erledigt die Arbeit und fragt vor allem, was zerstören könnte.",
  "task.agentMode.plan.label": "Plan",
  "task.agentMode.plan.description": "Untersuchen und einen Plan vorschlagen. Noch nichts ändern.",
  "task.agentMode.review.label": "Prüfen",
  "task.agentMode.review.description": "Prüfen und berichten. Nichts ändern.",

  /* ── a status, in the words a user reads ── */
  "status.queued": "Wartet auf Start",
  "status.running": "Läuft",
  "status.needsAttention": "Braucht deine Antwort",
  "status.idle": "Bereit",
  "status.done": "Fertig",
  "status.failed": "Mit Fehler gestoppt",
  "status.cancelled": "Gestoppt",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "Fertig.",
  "run.end.cancelled": "Gestoppt.",
  "run.end.failed": "Gestoppt, bevor es fertig war.",
  "run.end.other": "Beendet.",
  "run.diff.one": "1 Datei geändert.",
  "run.diff.many": "{count} Dateien geändert.",
  "run.context": "Kontext zu {percent} % voll.",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "Mesh verbunden — {count} Computer erreichbar",
  "mesh.attached.none": "Mesh verbunden — noch keine anderen Computer erreichbar",
  "mesh.noNode": "EnvoyMesh läuft nicht — Aufgaben bleiben auf diesem Computer",
  "mesh.refused": "EnvoyMesh hat EnvoyCoder keine Sitzung gewährt — Aufgaben bleiben auf diesem Computer",
  "mesh.peers": "{count} Peers",
  "mesh.scope.title": "Sitzungsbereich {scope}",
  "mesh.agentsHere": "Agenten laufen auf diesem Computer",

  /* ── settings ── */
  "settings.title": "Einstellungen",
  "settings.close": "Schließen",
  "settings.stateDir": "Daten in {path}",
  "settings.noDaemon": "Kein Dienst",
  "settings.daemon": "Dienst {version}",
  "settings.daemon.title": "Der Dienst, mit dem dieses Fenster verbunden ist",
  "settings.language.title": "Sprache",
  "settings.language.detail": "Die Sprache dieses Fensters — jede Beschriftung, jeder Hinweis und jeder Fehler, auch die, die der Dienst zurückschickt. Sie wird mit deinen Einstellungen auf diesem Computer gespeichert und folgt dir zu deinen anderen Fenstern und aufs Telefon.",
  "settings.language.aria": "Sprache",
  "settings.language.system": "Wie dieser Computer",
  "settings.defaultHarness.title": "Der Agent, mit dem neue Aufgaben starten",
  "settings.defaultHarness.detail": "Ein Projekt kann das überschreiben; das hier gilt, wenn es das nicht tut.",
  "settings.needsInstalling": "(muss installiert werden)",
  "settings.approvals.title": "Vor allem Destruktiven fragen",
  "settings.approvals.detail": "Agenten halten an und warten auf dich, statt Dateien zu überschreiben. Wenn du das ausschaltest, kann eine Aufgabe deinen Arbeitsbaum ohne Nachfrage ändern.",
  "settings.remoteRuns.title": "Die Agenten dieses Computers mit deinen anderen Computern teilen",
  "settings.remoteRuns.detail": "Standardmäßig aus. Wenn es an ist, kann eine Aufgabe von einem deiner anderen Computer hier laufen, in einem Verzeichnis von dir.",
  "settings.transcripts.title": "Transkripte nach dem Ende einer Aufgabe behalten",
  "settings.transcripts.detail": "Die Aufzeichnung dessen, was ein Agent getan hat, auf diesem Computer. Ausschalten spart Platz und macht „was hat es geändert?“ später unbeantwortbar.",
  "settings.agents.heading": "Agenten auf diesem Computer",
  "settings.agents.note": "Was ein Agent tatsächlich kann, entscheidet, was EnvoyCoder anbietet. Ein Agent, den man nicht um Erlaubnis bitten kann, bekommt keinen Genehmigungsdialog, den er ignorieren würde.",
  "settings.agents.empty": "Die Agentenliste ist noch nicht angekommen.",
  "settings.agent.notInstalled": "Nicht installiert",
  "settings.agent.unknown": "Unbekannt",
  "settings.agent.ready": "Bereit",
  "settings.agent.noApprovals": "Keine Genehmigungen",
  "settings.agent.noApprovals.title": "Dieser Agent fragt nie, bevor er handelt",
  "settings.agent.noCancel": "Nicht abbrechbar",
  "settings.agent.noCancel.title": "Diesen Agenten kann man nur stoppen, indem man seinen Prozess beendet",
  "settings.notes.heading": "Wissenswertes",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path} ist auf diesem Computer kein Verzeichnis. Wähle einen Ordner, der existiert — EnvoyCoder lässt Agenten darin laufen, der Pfad muss also echt sein.",
  "error.createTask.notDirectory": "{path} ist auf diesem Computer kein Verzeichnis, es gibt also keinen Ort, an dem der Agent laufen könnte. Es war das Arbeitsverzeichnis für „{title}“.",
  "error.updateTask.notDirectory": "{path} ist auf diesem Computer kein Verzeichnis, der Agent hätte also keinen Ort zum Laufen. Der Ordner der Aufgabe bleibt unverändert.",
  "error.agentModeUnsupported": "{harness} kann über das Protokoll, das EnvoyCoder mit ihm spricht, nicht in einen Modus versetzt werden, deshalb wurde dieser Lauf nicht gestartet. Lass den Modus ungesetzt, dann läuft {harness} in seinem eigenen Standard.",
  "error.agentModeUnknown": "{harness} bietet keinen Modus namens „{mode}“, deshalb wurde dieser Lauf nicht gestartet. Wähle einen seiner Modi und versuche es erneut.",
  "error.projectNotFound": "Es gibt auf diesem Computer kein Projekt namens „{id}“. Vielleicht wurde es in einem anderen Fenster entfernt.",
  "error.taskNotFound": "Es gibt auf diesem Computer keine Aufgabe namens „{id}“. Vielleicht wurde sie in einem anderen Fenster entfernt.",
  "error.runNotFound": "Es gibt keinen Lauf namens „{runId}“. Vielleicht wurde er von einem Dienst gestartet, der seitdem neu gestartet wurde.",
  "error.taskForRunMissing": "Es gibt keine Aufgabe namens „{taskId}“, es gibt also keinen Ort, an dem ein Agent laufen könnte.",
  "error.taskAlreadyRunning": "„{task}“ läuft bereits. Schick ihr stattdessen eine Nachricht — einen zweiten Agenten im selben Verzeichnis zu starten ist der Weg, auf dem zwei von ihnen dieselbe Datei bearbeiten.",
  "error.runFinished": "Dieser Lauf ist schon beendet, es gibt also nichts, wohin man ihm schreiben könnte. Starte stattdessen eine neue Aufgabe.",
  "error.approvalPending": "Der Agent wartet auf eine Antwort, bevor er weitermachen kann. Beantworte die zuerst — eine jetzt gesendete Nachricht würde dahinter warten.",
  "error.noRunRuntime": "Dieser Dienst wurde ohne Agenten-Laufzeit gestartet, deshalb kann er keine Aufgaben ausführen.",
  "error.harnessMissing": "{harness} ist auf diesem Computer nicht installiert. Installiere ihn und starte die Aufgabe dann erneut.",
  "error.harnessUnsupported": "{harness} spricht ein Protokoll, das EnvoyCoder noch nicht steuern kann (dieser Adapter steuert nur ACP-Agenten). Envoy Harness und DeepSeek Harness funktionieren heute; {harness} braucht einen eigenen Adapter.",
  "error.notConnected": "EnvoyCoder ist noch nicht mit seinem Dienst verbunden.",
  "error.notConnectedChange": "EnvoyCoder ist nicht mit seinem Dienst verbunden, deshalb wurde diese Änderung nicht gespeichert.",
  "error.connectionClosed": "Die Verbindung wurde geschlossen.",
  "error.daemonClosedConnection": "Der Dienst hat die Verbindung geschlossen.",
  "error.daemonTooOld":
    "Der Daemon, mit dem dieses Fenster spricht, ist eine ältere Version: Er kennt {method} nicht. Starte EnvoyCoder neu, damit Fenster und Daemon dieselbe Version verwenden, und versuche es erneut.",
  "error.notOurDaemon.product": "Auf dem Port des Dienstes antwortet etwas, das sich „{product}“ nennt. EnvoyCoder hat sich damit nicht verbunden.",
  "error.notOurDaemon.instance": "Der Dienst auf Port {port} ist nicht der, für den dieses Fenster gestartet wurde. Vielleicht hat ihn ein anderer EnvoyCoder-Dienst ersetzt — öffne das Fenster neu.",
  "error.shellEndpointFailed": "Das Fenster von EnvoyCoder konnte die Shell nicht fragen, wo der Dienst ist. Baue die Desktop-App neu (die Berechtigungsliste der Shell ist veraltet).",
  "error.shellEndpointMissing": "Die EnvoyCoder-Shell hat nicht gesagt, wo ihr Dienst ist. Ohne das kann sich dieses Fenster nicht verbinden.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder konnte {name} nicht lesen, hat die Datei nach {movedTo} verschoben und diese Liste leer begonnen. ({reason})",
  "note.quarantined.left": "EnvoyCoder konnte {name} nicht lesen und die Datei nicht verschieben, hat sie unangetastet gelassen und diese Liste leer begonnen. ({reason})",
  "note.skipped": "{file}: {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "Dem Agenten erlauben, „{tool}“ auszuführen?",
  "approval.question.generic": "Dem Agenten erlauben, fortzufahren?",
  "approval.detail": "Er hat vor diesem Schritt angehalten und macht erst weiter, wenn du antwortest. Diese eine Anfrage zu beantworten erlaubt nichts anderes.",
};
