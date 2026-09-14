/**
 * fr — the catalogue every string in this window is rendered from.
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

export const fr: Catalogue = {

  /* ── the product, and the machine it is on ── */
  "app.name": "EnvoyCoder",
  "app.thisMachine": "Cet ordinateur",
  "app.rail.show": "Afficher les projets",
  "app.rail.hide": "Masquer les projets",
  "app.rail.toggle": "Afficher ou masquer le volet des projets",
  "app.windows.count": "{count} fenêtres",
  "app.windows.title": "Ce service dessert toutes les fenêtres EnvoyCoder",

  /* ── the connection, said the way a user needs it ── */
  "connection.starting": "Démarrage…",
  "connection.unreachable": "Service injoignable",
  "connection.none": "Non connecté",

  /* ── the notice strip: only refusals speak ── */
  "notice.dismiss": "Masquer",

  /* ── the rail ── */
  "sidebar.aria": "Projets et tâches",
  "sidebar.add": "+ Ajouter un projet",
  "sidebar.add.title": "Enregistrer un dossier comme projet",
  "sidebar.command.title": "Ouvrir la palette de commandes",
  "sidebar.search.placeholder": "Rechercher tâches, dépôts, chemins",
  "sidebar.search.aria": "Rechercher des tâches, des dépôts et des chemins",
  "sidebar.view.groupBy": "Grouper par projet",
  "sidebar.view.flat": "Une liste unique, la plus récente d'abord",
  "sidebar.view.group": "Grouper",
  "sidebar.view.list": "Liste",
  "sidebar.attention.one": "1 tâche vous attend",
  "sidebar.attention.many": "{count} tâches vous attendent",
  "sidebar.empty.title": "Aucun projet pour l'instant",
  "sidebar.empty.body": "Ajoutez un dossier dans lequel vous travaillez. Les tâches que vous y lancez apparaissent ici, et le projet retient l'agent qu'elles doivent utiliser.",
  "sidebar.empty.noMatch": "Rien ne correspond à « {query} ».",
  "sidebar.section.tasks": "Tâches",
  "sidebar.project.attention": "Tâches qui vous attendent",
  "sidebar.project.agent": "L'agent avec lequel démarrent les nouvelles tâches de ce projet",
  "sidebar.project.settings": "Réglages du projet",
  "sidebar.project.settings.aria": "Réglages du projet {project}",
  "sidebar.project.newTask": "+ Nouvelle",
  "sidebar.project.newTask.title": "Lancer une tâche dans {project}",
  "sidebar.tasks.empty": "Aucune tâche ici pour l'instant.",
  "sidebar.footer.add": "Ajouter un projet",
  "sidebar.footer.host": "Hôte : {host}",
  "sidebar.footer.import": "Importer une session (pas encore développé)",
  "sidebar.footer.import.title": "Importer une session depuis l'historique d'un autre agent n'est pas encore développé — il faut un lecteur par agent.",
  "sidebar.footer.help": "Aide et assistance (pas encore développé)",
  "sidebar.footer.help.title": "Pas encore d'écran d'aide : le registre de raccourcis existe, la fiche d'aide non.",
  "sidebar.footer.settings": "Réglages",

  /* ── the command palette ── */
  "palette.title": "Palette de commandes",
  "palette.placeholder": "Saisissez une commande",
  "palette.search.aria": "Rechercher des commandes",
  "palette.value": "Valeur",
  "palette.selected": "Sélectionné",
  "palette.empty": "Rien ne correspond.",
  "palette.group.projects": "Projets",
  "palette.group.tasks": "Tâches",
  "palette.group.machine": "Cet ordinateur",
  "palette.addProject.title": "Ajouter un projet…",
  "palette.addProject.subtitle": "Enregistrer un dossier dans lequel vous travaillez",
  "palette.addProject.pickPrompt": "Choisir un dossier de projet",
  "palette.addProject.noFolder": "Aucun dossier n'a été choisi, donc rien n'a été ajouté.",
  "palette.newTask.title": "Nouvelle tâche dans {project}",
  "palette.newTask.label": "Que doit faire l'agent ?",
  "palette.newTask.placeholder": "Décrivez la tâche",
  "palette.openTask.subtitle": "Ouvrir cette tâche",
  "palette.pairPhone.title": "Associer un téléphone",
  "palette.pairPhone.subtitle": "Afficher un code que l'appli mobile peut scanner",
  "palette.pairPhone.notYet": "L'association d'un téléphone arrive avec l'étape mobile : le service n'a pas encore de stockage de sessions, il refuse donc les clients distants à dessein.",
  "palette.toggleRail.title": "Afficher ou masquer le volet des projets",
  "palette.settings.title": "Ouvrir les réglages",
  "palette.settings.subtitle": "Valeurs par défaut des nouvelles tâches, et ce qui demande une approbation",
  "palette.noPicker": "Cette fenêtre n'a pas de shell à interroger — collez plutôt le chemin du dossier.",
  "palette.pickerFailed": "Le sélecteur de dossier n'a pas pu s'ouvrir : {detail}",

  /* ── the work area with nothing in it, and the three reasons why ── */
  "work.offline.title": "EnvoyCoder n'atteint pas son service",
  "work.offline.body": "Le service est le processus qui exécute vos tâches, et il ne répond pas. Il démarre avec l'application, donc cela se règle généralement en un instant.",
  "work.loading": "Chargement de vos projets…",
  "work.noTask.title": "Aucune tâche ouverte",
  "work.noTask.body": "Choisissez une tâche à gauche, ou lancez-en une dans un projet. Les agents s'exécutent sur cet ordinateur et, quand le mesh est attaché, sur vos autres ordinateurs aussi.",
  "work.noProjects.title": "Aucun projet pour l'instant",
  "work.noProjects.body": "Ajoutez un dossier dans lequel vous travaillez, et EnvoyCoder pourra y faire tourner des agents.",
  "work.noTask.action": "Lancer une tâche",
  "work.noProjects.action": "Ajouter un projet",

  /* ── the task pane, its transcript and its composer ── */
  "task.aria": "Tâche {title}",
  "task.meta.agent": "L'agent qui exécute cette tâche",
  "task.meta.cwd": "Dossier de travail : {path}",
  "task.meta.host": "Ordinateur qui exécute cette tâche",
  "task.cancel": "Arrêter",
  "task.cancel.title": "Demander à l'agent de s'arrêter",
  "task.transcript.gap": "Une partie de l'historique de cette tâche n'est pas arrivée. Ce qui est là est dans l'ordre ; rechargez pour redemander.",
  "task.transcript.empty.title": "Rien pour l'instant",
  "task.transcript.empty.body": "Demandez quelque chose et l'agent travaille dans {cwd}. Les appels d'outils, les approbations et les diffs apparaissent ici au fur et à mesure.",
  "task.you": "Vous",
  "task.delivered.steered": "a rejoint le tour",
  "task.delivered.queued": "a attendu le tour",
  "task.thought.summary": "Comment il y a réfléchi",
  "task.approval.aria": "L'agent attend votre réponse",
  "task.approval.answered": "Répondu",
  "task.approval.answeredWith": "Répondu : {option}",
  "task.composer.aria": "Écrire à l'agent",
  "task.composer.placeholder.approval": "Répondez à la demande ci-dessus avant d'envoyer quoi que ce soit",
  "task.composer.placeholder.running": "Ajoutez une suite — « File » attend ce tour, « Orienter » le rejoint",
  "task.composer.placeholder.idle": "Décrivez la tâche",
  "task.composer.queue": "File",
  "task.composer.steer": "Orienter",
  "task.composer.mode.aria": "Comment délivrer le message",
  "task.composer.mode.title": "« File » attend le tour en cours ; « Orienter » le rejoint",
  "task.composer.send": "Envoyer",
  "task.composer.start": "Démarrer",
  "task.composer.submit.blocked": "Répondez d'abord à la demande ci-dessus",

  /* ── a status, in the words a user reads ── */
  "status.queued": "En attente de démarrage",
  "status.running": "En cours",
  "status.needsAttention": "Attend votre réponse",
  "status.idle": "Inactif",
  "status.done": "Terminé",
  "status.failed": "Arrêté sur une erreur",
  "status.cancelled": "Arrêté",

  /* ── lines the transcript folds out of run events ── */
  "run.end.done": "Terminé.",
  "run.end.cancelled": "Arrêté.",
  "run.end.failed": "Arrêté avant la fin.",
  "run.end.other": "Fini.",
  "run.diff.one": "1 fichier modifié.",
  "run.diff.many": "{count} fichiers modifiés.",
  "run.context": "Contexte rempli à {percent} %.",

  /* ── the status line, and the one place the mesh is always visible ── */
  "mesh.attached.peers": "Mesh connecté — {count} machines joignables",
  "mesh.attached.none": "Mesh connecté — aucune autre machine joignable pour l'instant",
  "mesh.noNode": "EnvoyMesh n'est pas lancé — les tâches restent sur cet ordinateur",
  "mesh.refused": "EnvoyMesh a refusé une session à EnvoyCoder — les tâches restent sur cet ordinateur",
  "mesh.peers": "{count} pairs",
  "mesh.scope.title": "Portée de session {scope}",
  "mesh.agentsHere": "Les agents s'exécutent sur cet ordinateur",

  /* ── settings ── */
  "settings.title": "Réglages",
  "settings.close": "Fermer",
  "settings.stateDir": "Données dans {path}",
  "settings.noDaemon": "Aucun service",
  "settings.daemon": "Service {version}",
  "settings.daemon.title": "Le service auquel cette fenêtre est attachée",
  "settings.language.title": "Langue",
  "settings.language.detail": "La langue de cette fenêtre — chaque libellé, chaque avis et chaque erreur, y compris ceux que le service renvoie. Elle est enregistrée avec vos réglages sur cet ordinateur, et vous suit donc sur vos autres fenêtres et sur le téléphone.",
  "settings.language.aria": "Langue",
  "settings.language.system": "Comme cet ordinateur",
  "settings.defaultHarness.title": "L'agent avec lequel démarrent les nouvelles tâches",
  "settings.defaultHarness.detail": "Un projet peut le remplacer ; ceci s'applique quand ce n'est pas le cas.",
  "settings.needsInstalling": "(à installer)",
  "settings.approvals.title": "Demander avant toute action destructrice",
  "settings.approvals.detail": "Les agents s'arrêtent et vous attendent au lieu d'écraser des fichiers. Désactiver ceci signifie qu'une tâche peut modifier votre arbre de travail sans demander.",
  "settings.remoteRuns.title": "Partager les agents de cet ordinateur avec vos autres ordinateurs",
  "settings.remoteRuns.detail": "Désactivé par défaut. Quand c'est activé, une tâche venue d'un de vos autres ordinateurs peut s'exécuter ici, dans un dossier qui vous appartient.",
  "settings.transcripts.title": "Conserver les transcriptions après la fin d'une tâche",
  "settings.transcripts.detail": "Le compte rendu de ce qu'un agent a fait, conservé sur cet ordinateur. Le désactiver économise de l'espace et rend « qu'a-t-il modifié ? » sans réponse plus tard.",
  "settings.agents.heading": "Agents sur cet ordinateur",
  "settings.agents.note": "Ce que chaque agent sait réellement faire détermine ce qu'EnvoyCoder propose. Un agent qu'on ne peut pas interroger pour une permission ne reçoit pas de dialogue d'approbation qu'il ignorerait.",
  "settings.agents.empty": "La liste des agents n'est pas encore arrivée.",
  "settings.agent.notInstalled": "Non installé",
  "settings.agent.unknown": "Inconnu",
  "settings.agent.ready": "Prêt",
  "settings.agent.noApprovals": "Sans approbations",
  "settings.agent.noApprovals.title": "Cet agent ne demande jamais avant d'agir",
  "settings.agent.noCancel": "Non annulable",
  "settings.agent.noCancel.title": "Le seul moyen d'arrêter cet agent est de terminer son processus",
  "settings.notes.heading": "Bon à savoir",

  /* ── what the daemon says when it refuses ── */
  "error.addProject.notDirectory": "{path} n'est pas un dossier sur cet ordinateur. Choisissez un dossier qui existe — EnvoyCoder y fait tourner des agents, le chemin doit donc être réel.",
  "error.createTask.notDirectory": "{path} n'est pas un dossier sur cet ordinateur, il n'y a donc nulle part où exécuter l'agent. C'était le dossier de travail de « {title} ».",
  "error.projectNotFound": "Il n'y a pas de projet nommé « {id} » sur cet ordinateur. Il a peut-être été supprimé depuis une autre fenêtre.",
  "error.taskNotFound": "Il n'y a pas de tâche nommée « {id} » sur cet ordinateur. Elle a peut-être été supprimée depuis une autre fenêtre.",
  "error.runNotFound": "Il n'y a pas d'exécution nommée « {runId} ». Elle a peut-être été lancée par un service redémarré depuis.",
  "error.taskForRunMissing": "Il n'y a pas de tâche nommée « {taskId} », il n'y a donc nulle part où exécuter un agent.",
  "error.taskAlreadyRunning": "« {task} » est déjà en cours. Envoyez-lui plutôt un message — lancer un second agent dans un même dossier est la façon dont deux d'entre eux finissent par modifier le même fichier.",
  "error.runFinished": "Cette exécution est déjà terminée, il n'y a donc rien à quoi l'envoyer. Lancez plutôt une nouvelle tâche.",
  "error.approvalPending": "L'agent attend une réponse avant de pouvoir continuer. Répondez d'abord — un message envoyé maintenant attendrait derrière.",
  "error.noRunRuntime": "Ce service a été démarré sans moteur d'agent, il ne peut donc pas exécuter de tâches.",
  "error.harnessMissing": "{harness} n'est pas installé sur cet ordinateur. Installez-le, puis relancez la tâche.",
  "error.harnessUnsupported": "{harness} parle un protocole qu'EnvoyCoder ne sait pas encore piloter (cet adaptateur ne pilote que des agents ACP). Envoy Harness et DeepSeek Harness fonctionnent aujourd'hui ; {harness} a besoin de son propre adaptateur.",
  "error.notConnected": "EnvoyCoder n'est pas encore connecté à son service.",
  "error.notConnectedChange": "EnvoyCoder n'est pas connecté à son service, cette modification n'a donc pas été enregistrée.",
  "error.connectionClosed": "La connexion a été fermée.",
  "error.daemonClosedConnection": "Le service a fermé la connexion.",
  "error.notOurDaemon.product": "Quelque chose répond sur le port du service, mais il se présente comme « {product} ». EnvoyCoder ne s'y est pas connecté.",
  "error.notOurDaemon.instance": "Le service sur le port {port} n'est pas celui pour lequel cette fenêtre a été lancée. Un autre service EnvoyCoder l'a peut-être remplacé — rouvrez la fenêtre.",
  "error.shellEndpointFailed": "La fenêtre d'EnvoyCoder n'a pas pu demander au shell où se trouve le service. Reconstruisez l'application de bureau (la liste des permissions du shell est périmée).",
  "error.shellEndpointMissing": "Le shell d'EnvoyCoder n'a pas indiqué où se trouve son service. Sans cela, cette fenêtre ne peut pas se connecter.",

  /* ── what the daemon wanted the user to know at startup ── */
  "note.quarantined.moved": "EnvoyCoder n'a pas pu lire {name}, l'a donc mis de côté dans {movedTo} et a redémarré cette liste à vide. ({reason})",
  "note.quarantined.left": "EnvoyCoder n'a pas pu lire {name} et n'a pas pu le déplacer, il l'a donc laissé intact et a redémarré cette liste à vide. ({reason})",
  "note.skipped": "{file} : {reason}",

  /* ── an approval, in the daemon's own words ── */
  "approval.question.tool": "Autoriser l'agent à exécuter « {tool} » ?",
  "approval.question.generic": "Autoriser l'agent à continuer ?",
  "approval.detail": "Il s'est arrêté avant cette étape et ne continuera pas avant votre réponse. Répondre à cette seule demande n'autorise rien d'autre.",
};
