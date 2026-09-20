// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get appName => 'EnvoyDev';

  @override
  String get commonAdd => 'Ajouter';

  @override
  String get commonCancel => 'Annuler';

  @override
  String get commonClear => 'Effacer';

  @override
  String get commonConfirm => 'Confirmer';

  @override
  String get commonContinue => 'Continuer';

  @override
  String get commonNone => 'aucun';

  @override
  String get commonNotSet => 'Non défini';

  @override
  String get commonOk => 'D\'accord';

  @override
  String get commonRemove => 'Retirer';

  @override
  String get commonRename => 'Renommer';

  @override
  String get commonSave => 'Enregistrer';

  @override
  String get commonSaving => 'Enregistrement…';

  @override
  String get connectionStateConnected => 'Connecté';

  @override
  String get connectionStateConnecting => 'Connexion…';

  @override
  String get connectionStateReconnecting =>
      'Reconnexion — vos tâches continuent';

  @override
  String get connectionStateFailed => 'Injoignable';

  @override
  String get connectionStateIdle => 'Pas encore connecté';

  @override
  String get connectionsTitle => 'Connexions';

  @override
  String connectionsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ordinateurs',
      one: '1 ordinateur',
    );
    return '$_temp0';
  }

  @override
  String get connectionsAddHost => 'Ajouter un hôte';

  @override
  String get connectionsAddHostSubtitle =>
      'Scannez un code, ou saisissez une adresse';

  @override
  String get connectionsEmpty => 'Aucun ordinateur associé pour l\'instant.';

  @override
  String connectionsCurrent(String name) {
    return '$name · actuel';
  }

  @override
  String connectionsRowDetail(String endpoint, String state) {
    return '$endpoint · $state';
  }

  @override
  String connectionsRowDetailVia(String endpoint, String state, String route) {
    return '$endpoint · $state · par $route';
  }

  @override
  String get connectionsRenameTitle => 'Renommer la connexion';

  @override
  String get connectionsRenameField => 'Nom de la connexion';

  @override
  String get connectionsRenameEmpty => 'Saisissez un nom pour cette connexion.';

  @override
  String connectionsForgetTitle(String name) {
    return 'Oublier $name ?';
  }

  @override
  String get connectionsForgetMessage =>
      'Ce téléphone cessera de se connecter à cet ordinateur et oubliera l\'association. Les tâches déjà en cours là-bas continuent.';

  @override
  String get connectionsForgetConfirm => 'Oublier';

  @override
  String connectionsMenuAria(String name) {
    return 'Autres actions pour $name';
  }

  @override
  String get connectionsMenuForget => 'Oublier l\'hôte';

  @override
  String get hostScanQr => 'Scanner un QR';

  @override
  String get hostScanQrSubtitle => 'Associez avec le code de votre ordinateur';

  @override
  String get hostPasteLink => 'Coller un lien';

  @override
  String get hostPasteLinkSubtitle =>
      'Collez le lien d\'association d\'EnvoyDev';

  @override
  String get hostPasteLinkTitle => 'Coller le lien d\'association';

  @override
  String get hostPasteLinkHint => 'envoy://pair?…';

  @override
  String get hostDirectTcp => 'TCP direct';

  @override
  String get hostDirectTcpSubtitle => 'Hôte, port et jeton facultatif';

  @override
  String get hostRemoteSsh => 'SSH distant';

  @override
  String get hostRemoteSshSubtitle => 'Joindre le service via un saut SSH';

  @override
  String get hostFieldHostPort => 'Hôte:port';

  @override
  String get hostFieldToken => 'Jeton (facultatif si déjà associé)';

  @override
  String get hostFieldTokenHelper =>
      'Conservé uniquement sur ce téléphone — jamais affiché dans la liste.';

  @override
  String get hostFieldLabel => 'Libellé (facultatif)';

  @override
  String get hostFieldSshHost => 'Hôte SSH';

  @override
  String get hostFieldUser => 'Utilisateur';

  @override
  String get hostFieldSshPort => 'Port SSH';

  @override
  String get hostFieldPassword => 'Mot de passe';

  @override
  String get hostFieldDaemon => 'Service à distance (hôte:port)';

  @override
  String get hostFieldDaemonHelper =>
      'Généralement 127.0.0.1:4770 sur cette machine';

  @override
  String get hostFieldPairingToken =>
      'Jeton d\'association (facultatif en SSH)';

  @override
  String get hostFieldPairingTokenHelper =>
      'Le tunnel arrive comme la machine elle-même, donc il est digne de confiance';

  @override
  String get hostRefusedTitle => 'Cela n\'a pas ajouté de machine';

  @override
  String get hostScanTitle => 'Scanner le code d\'association';

  @override
  String get hostScanHint =>
      'Pointez la caméra vers le QR de votre ordinateur.';

  @override
  String get hostNoHostsTitle => 'Aucun ordinateur associé pour l\'instant';

  @override
  String get hostNoHostsBody =>
      'Sur votre ordinateur, ouvrez EnvoyDev → Associer un téléphone, puis scannez le code. Vos agents continuent de tourner, que le téléphone soit connecté ou non.';

  @override
  String get errorPairingEmpty => 'Ce code d\'association est vide.';

  @override
  String get errorPairingMalformed =>
      'Cela ne ressemble pas à un code d\'association.';

  @override
  String get errorPairingUnreadable =>
      'Ce code d\'association n\'a pas pu être lu. Demandez à l\'ordinateur de l\'afficher à nouveau.';

  @override
  String get errorPairingAddress =>
      'Ce code d\'association porte une adresse que cette appli ne peut pas lire.';

  @override
  String get errorPairingOtherApp => 'Ce code est destiné à une autre appli';

  @override
  String get errorAddHostNotHostPort =>
      'Ce n\'est pas un hôte et un port. Écrivez-le « machine:4770 » — l\'adresse et le port sur lesquels le service écoute.';

  @override
  String get errorAddHostNeedsToken =>
      'EnvoyDev refuse quiconque n\'est pas sur la machine elle-même, donc cette route a besoin du jeton d\'un lien d\'association. Utilisez « Scanner un QR » ou « Coller un lien », ou collez aussi le jeton ici.';

  @override
  String get errorAddHostSshHost =>
      'Par quelle machine le tunnel doit-il passer ? Saisissez son hôte SSH.';

  @override
  String get errorAddHostSshPort =>
      'Le port SSH doit être un nombre entre 1 et 65535. Il vaut 22 par défaut.';

  @override
  String get errorAddHostDaemon =>
      'Le service de cette machine se nomme « hôte:port ». Écrivez-le « 127.0.0.1:4770 » — c\'est le cas de presque toutes les machines, et c\'est l\'adresse telle que vue *depuis* la machine.';

  @override
  String get pairingNameTitle => 'Nommer cette connexion';

  @override
  String get pairingNameField => 'Nom de la connexion';

  @override
  String get pairingNameHelper =>
      'Affiché dans la liste des connexions — l\'adresse est conservée aussi.';

  @override
  String nameTooLong(int count) {
    return '$count caractères au maximum.';
  }

  @override
  String get settingsTitle => 'Réglages';

  @override
  String get settingsLoadFailed => 'Impossible de charger les réglages.';

  @override
  String get settingsSaveFailed => 'Impossible d\'enregistrer les réglages.';

  @override
  String get settingsSaveNoModel =>
      'Réglages enregistrés. Saisissez un modèle pour enregistrer les réglages LLM.';

  @override
  String get settingsSavedOnComputer =>
      'Réglages enregistrés sur l\'ordinateur.';

  @override
  String get settingsSavedLlmFailed =>
      'Réglages enregistrés, mais pas les réglages LLM.';

  @override
  String get settingsComputerHeading => 'Sur l\'ordinateur';

  @override
  String get settingsComputerDetail =>
      'Ces réglages vivent sur la machine associée. Le téléphone ne fait que les modifier.';

  @override
  String get settingsApprovals => 'Demander avant toute action destructrice';

  @override
  String get settingsTranscripts =>
      'Conserver les transcriptions après la fin d\'une tâche';

  @override
  String get settingsLanguage => 'Langue';

  @override
  String get settingsLanguageSystem => 'Comme cet ordinateur';

  @override
  String get settingsDefaultAgent =>
      'L\'agent avec lequel démarrent les nouvelles tâches';

  @override
  String get settingsLlmHeading => 'LLM';

  @override
  String get settingsLlmDetail =>
      'URL de base, modèle et clé API pour Envoy Harness.';

  @override
  String get settingsBaseUrl => 'URL de base';

  @override
  String get settingsBaseUrlHint =>
      'Facultatif — laissez vide pour la valeur par défaut du fournisseur';

  @override
  String get settingsModel => 'Modèle';

  @override
  String get settingsModelHint => 'gpt-4o or anthropic/claude-sonnet-4-5';

  @override
  String get settingsApiKeySaved => 'Clé API enregistrée sur cette machine.';

  @override
  String get settingsApiKey => 'Clé API';

  @override
  String get settingsApiKeyHint =>
      'Collez une nouvelle clé pour remplacer celle enregistrée';

  @override
  String get settingsLanguageDaemonFailed =>
      'Le téléphone est maintenant dans cette langue, mais l\'ordinateur n\'a pas pu être mis à jour.';

  @override
  String get networkTitle => 'État du réseau';

  @override
  String get networkCheckAgain => 'Vérifier à nouveau';

  @override
  String get networkCopyReport => 'Copier le rapport';

  @override
  String get networkCopied =>
      'Rapport réseau copié — collez-le dans le rapport de bug.';

  @override
  String get networkTokenNote =>
      'Le jeton d\'association n\'est jamais affiché ici — c\'est un secret.';

  @override
  String get networkComputer => 'Ordinateur';

  @override
  String get networkActiveRoute => 'Route active';

  @override
  String get networkApp => 'Appli';

  @override
  String get networkPairingHeading => 'Ce que l\'association nous a donné';

  @override
  String get networkDesktopPeerId => 'Pair de l\'ordinateur';

  @override
  String get networkDialablePeers => 'Adresses de pair joignables';

  @override
  String get networkPairingMissing =>
      'Les deux sont nécessaires à la route pair à pair, donc cet hôte n\'en a aucun. Une association faite avant que l\'ordinateur ne porte ces champs n\'a ni l\'un ni l\'autre — le téléphone se retrouve avec l\'adresse directe et le relais.';

  @override
  String get networkLadderHeading => 'Comment cet ordinateur a été essayé';

  @override
  String get networkLadderNoCandidatesYet =>
      'Aucun candidat pour l\'instant — rien n\'a été appelé pour cet ordinateur.';

  @override
  String get networkLadderNoCandidates =>
      'Ce passage n\'a produit aucun candidat : la marche est retenue sous pression d\'appels, ou l\'association ne nomme aucune adresse.';

  @override
  String networkLadderLimit(int limit, int waiting, int total) {
    return 'Ce passage appelle au plus $limit : $waiting sur $total attendent le passage suivant.';
  }

  @override
  String get networkAttemptConnected => 'connecté';

  @override
  String get networkAttemptFailed => 'échec';

  @override
  String get networkAttemptNoAnswer => 'sans réponse';

  @override
  String get networkAttemptDialling => 'appel en cours';

  @override
  String get networkAttemptNotTried => 'non essayé';

  @override
  String get networkAttemptPlanned => 'prévu';

  @override
  String get networkLastRequestHeading => 'Dernière requête à l\'ordinateur';

  @override
  String get networkNothingAsked =>
      'Rien n\'a encore été demandé depuis le démarrage de l\'appli.';

  @override
  String get networkMethod => 'Méthode';

  @override
  String get networkOutcome => 'Résultat';

  @override
  String get networkAnswered => 'répondu';

  @override
  String get networkTook => 'Durée';

  @override
  String get networkLastWalk => 'Dernière marche';

  @override
  String get networkPhoneNodeHeading => 'Le nœud libp2p de ce téléphone';

  @override
  String get networkNodeNotStarted =>
      'Non démarré — aucune route pair à pair n\'a été appelée dans ce lancement. Il démarre au premier appel de ce type, et regarder cet écran ne le démarre pas.';

  @override
  String get networkPeerId => 'Identifiant de pair';

  @override
  String get networkStarting => 'démarrage';

  @override
  String get networkRelayDialling => 'Appel du relais';

  @override
  String get networkEnabled => 'activé';

  @override
  String get networkDisabled => 'désactivé';

  @override
  String get networkRelayReservation => 'Réservation de relais';

  @override
  String get networkConnectedPeers => 'Pairs connectés';

  @override
  String get networkConnectedPeersUnavailable =>
      'indisponible — le nœud partagé n\'expose aucune vue des connexions';

  @override
  String get networkLanPeers => 'Pairs vus sur le réseau local';

  @override
  String get networkMdns => 'mDNS';

  @override
  String get networkActive => 'actif';

  @override
  String get networkInactive => 'inactif';

  @override
  String get networkRegisteredProtocols => 'Protocoles enregistrés';

  @override
  String get networkHostGeneration => 'Génération de l\'hôte';

  @override
  String get networkDesktopMeshHeading =>
      'Ce que l\'ordinateur dit de lui-même';

  @override
  String get networkNotAsked =>
      'Pas encore demandé. « Vérifier à nouveau » demande à l\'ordinateur son propre état de mesh — la différence entre « ce téléphone ne peut pas l\'atteindre » et « il n\'y a rien à atteindre ».';

  @override
  String networkNoUsableAnswer(String reason) {
    return 'Aucune réponse utilisable : $reason';
  }

  @override
  String get networkUnreadable => 'illisible';

  @override
  String get networkState => 'État';

  @override
  String get networkItsPeerId => 'Son identifiant de pair';

  @override
  String get networkItsDialable => 'Ses adresses joignables';

  @override
  String get networkItsRelayHints => 'Ses indices de relais';

  @override
  String get networkPeersConnected => 'Pairs auxquels il est connecté';

  @override
  String get networkItsReason => 'Sa raison';

  @override
  String get explorerTitle => 'Explorateur';

  @override
  String get explorerFiles => 'Fichiers';

  @override
  String get explorerChanges => 'Modifications';

  @override
  String get explorerFolderEmpty => 'Ce dossier est vide.';

  @override
  String get explorerCouldNotList => 'Impossible de lister ce dossier.';

  @override
  String get explorerNotRepo => 'Ce dossier n’est pas un dépôt Git.';

  @override
  String get explorerNoChanges => 'Aucune modification dans ce dossier.';

  @override
  String get explorerCouldNotRead => 'Impossible de lire les modifications.';

  @override
  String get explorerKindAdded => 'Ajouté';

  @override
  String get explorerKindModified => 'Modifié';

  @override
  String get explorerKindDeleted => 'Supprimé';

  @override
  String get explorerKindRenamed => 'Renommé';

  @override
  String get explorerKindNew => 'Nouveau';

  @override
  String get explorerKindConflict => 'Conflit';

  @override
  String get folderTitle => 'Choisir un dossier de projet';

  @override
  String get folderUseThisFolder => 'Utiliser ce dossier';

  @override
  String get folderComputer => 'Ordinateur';

  @override
  String get folderDrives => 'Lecteurs';

  @override
  String get folderHome => 'Dossier personnel';

  @override
  String get folderParent => 'Dossier parent';

  @override
  String get folderEmpty => 'Aucun sous-dossier ici';

  @override
  String get runStop => 'Arrêter';

  @override
  String get runStopping => 'Arrêt…';

  @override
  String get runLive => 'En cours';

  @override
  String get runToggleExplorer => 'Afficher ou masquer l’explorateur';

  @override
  String get runCouldNotAnswer =>
      'Impossible d\'envoyer cette réponse. Réessayez.';

  @override
  String get runCouldNotUpdateTask =>
      'Impossible de mettre à jour la tâche sur l\'ordinateur.';

  @override
  String get runCouldNotSend => 'Impossible d\'envoyer. Réessayez.';

  @override
  String get runCouldNotStop =>
      'Impossible d\'arrêter l\'exécution. Réessayez.';

  @override
  String get runNoFolder => 'Cette tâche n\'a pas encore de dossier.';

  @override
  String get runCouldNotOpen => 'Impossible d\'ouvrir cette exécution.';

  @override
  String get runEarlierNotHere =>
      'La conversation précédente n\'est pas sur cet ordinateur. Un nouveau message démarre quand même ici.';

  @override
  String get runHistoryGap =>
      'Une partie de l\'historique de cette tâche n\'est pas arrivée. Ce qui est là est dans l\'ordre.';

  @override
  String get runQueue => 'File';

  @override
  String get runSteer => 'Orienter';

  @override
  String get runJoinsTurn => 'Rejoint le tour maintenant';

  @override
  String get runWaitsTurn => 'Attend la fin de ce tour';

  @override
  String get runPlaceholderAnswer => 'Répondez d\'abord à la demande ci-dessus';

  @override
  String get runPlaceholderFollowUp => 'Ajoutez une suite…';

  @override
  String get runPlaceholderContinue => 'Envoyez un message pour continuer';

  @override
  String get runYou => 'Vous';

  @override
  String get runYouSteered => 'Vous · a rejoint le tour';

  @override
  String get runYouQueued => 'Vous · a attendu le tour';

  @override
  String get runThoughtTitle => 'Comment il y a réfléchi';

  @override
  String get runAnswered => 'Répondu';

  @override
  String runAnsweredWith(String option) {
    return 'Répondu : $option';
  }

  @override
  String get runNeedsAnswer => 'L\'agent attend votre réponse';

  @override
  String approvalQuestionTool(String tool) {
    return 'Autoriser l\'agent à exécuter « $tool » ?';
  }

  @override
  String get approvalQuestionGeneric => 'Autoriser l\'agent à continuer ?';

  @override
  String get approvalQuestionAsk => 'L\'agent a posé une question.';

  @override
  String get approvalDetail =>
      'Il s\'est arrêté avant cette étape et ne continuera pas avant votre réponse. L\'autoriser permet de refaire cette même étape dans ce projet sans redemander.';

  @override
  String get approvalDetailPick =>
      'Choisissez-en une. Cette réponse ne concerne que cette question.';

  @override
  String get approvalDetailMultiple =>
      'Cochez chaque option qui convient, puis confirmez. Cette réponse ne concerne que cette question.';

  @override
  String get approvalDetailText =>
      'Écrivez votre réponse. L\'agent ne continuera pas tant que vous ne l\'aurez pas envoyée.';

  @override
  String get approvalAllow => 'Autoriser';

  @override
  String get approvalDeny => 'Ne pas autoriser';

  @override
  String get runApprovalNeedsDecision => 'L\'agent attend une décision.';

  @override
  String get runNoLongerWaiting => 'N\'attend plus.';

  @override
  String get runYourAnswer => 'Votre réponse';

  @override
  String get runToolFallback => 'outil';

  @override
  String runNoteDiff(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count fichiers modifiés.',
      one: '1 fichier modifié.',
    );
    return '$_temp0';
  }

  @override
  String runNoteContext(int percent) {
    return 'Contexte rempli à $percent %.';
  }

  @override
  String get runNoteFinished => 'Terminé.';

  @override
  String get runNoteStopped => 'Arrêté.';

  @override
  String get runNoteStoppedBefore => 'Arrêté avant la fin.';

  @override
  String get runNoteEnded => 'Fini.';

  @override
  String get attachAdd => 'Ajouter une image';

  @override
  String get attachTooltip => 'Joindre';

  @override
  String get attachPaste => 'Coller une image';

  @override
  String get attachFile => 'Ajouter un fichier';

  @override
  String attachRemove(String name) {
    return 'Retirer $name';
  }

  @override
  String get attachTooBig => 'Ce fichier est trop volumineux pour être joint.';

  @override
  String get attachBinary =>
      'Seules les images et les fichiers texte peuvent être joints.';

  @override
  String get attachUnreadable => 'Impossible de lire ce fichier.';

  @override
  String get attachEmpty => 'Ce fichier est vide.';

  @override
  String attachLimit(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Vous pouvez joindre jusqu\'à $count fichiers.',
      one: 'Vous pouvez joindre 1 fichier.',
    );
    return '$_temp0';
  }

  @override
  String get attachClipboardMissing => 'Aucune image dans le presse-papiers.';

  @override
  String get attachFailed => 'Ce fichier n\'a pas pu être joint.';

  @override
  String get attachImagesOnly => 'Regarde l\'image jointe.';

  @override
  String get attachImagesOnlyMany => 'Regarde les images jointes.';

  @override
  String attachNamed(String names) {
    return 'Joint : $names';
  }

  @override
  String get addProjectTitle => 'Ajouter un projet';

  @override
  String get addProjectDetail =>
      'Choisissez un dossier sur cet ordinateur. Les agents s\'exécuteront dedans.';

  @override
  String get addProjectFolder => 'Dossier';

  @override
  String get addProjectFolderHint => '/Users/you/work/repo';

  @override
  String get addProjectBrowse => 'Choisir…';

  @override
  String get addProjectDefaultAgent => 'Agent par défaut';

  @override
  String get addProjectChooseFolder =>
      'Choisissez un dossier sur cet ordinateur.';

  @override
  String get addProjectSubmit => 'Ajouter le projet';

  @override
  String get markdownMermaid =>
      'Diagramme Mermaid — la source est affichée ici ; l\'ordinateur rend le graphique dans l\'appli de bureau.';

  @override
  String get markdownCopy => 'Copier';

  @override
  String get markdownCopied => 'Copié';

  @override
  String projectListAttention(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tâches vous attendent',
      one: '1 tâche vous attend',
    );
    return '$_temp0';
  }

  @override
  String get projectListNoProjects =>
      'Aucun projet pour l\'instant — ajoutez un dossier sur cet ordinateur.';

  @override
  String get projectListNoMatch => 'Rien ne correspond à cette recherche.';

  @override
  String projectListCouldNotLoad(String detail) {
    return 'Impossible de charger le travail depuis cet ordinateur. $detail';
  }

  @override
  String get commonConnectionFailed => 'La connexion a échoué.';

  @override
  String get projectListCouldNotChangeAgent =>
      'Impossible de changer l\'agent du projet.';

  @override
  String projectListRemoveTitle(String project) {
    return 'Retirer « $project » ?';
  }

  @override
  String get projectListRemoveMessage =>
      'Le projet quitte EnvoyDev et ses tâches quittent la liste — elles sont archivées, pas supprimées, et rien n\'est touché dans ce dossier. Retirer le projet est irréversible.';

  @override
  String projectListRemoveFailed(String project) {
    return 'Impossible de retirer $project. Il est toujours dans la liste.';
  }

  @override
  String projectListRemoved(String project) {
    return 'Projet « $project » retiré.';
  }

  @override
  String projectListRemovedArchived(String project, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count tâches ont été archivées.',
      one: '1 tâche a été archivée.',
    );
    return 'Projet « $project » retiré. $_temp0';
  }

  @override
  String taskRemoveTitle(String title) {
    return 'Retirer « $title » ?';
  }

  @override
  String get taskRemoveMessage =>
      'Elle quitte la liste des tâches. Le dossier, ses fichiers et la transcription restent sur cet ordinateur — archiver n\'est pas supprimer.';

  @override
  String projectListRemoveTaskFailed(String title) {
    return 'Impossible de retirer « $title ». Elle est toujours dans la liste.';
  }

  @override
  String get runCouldNotRemove =>
      'Impossible de retirer cette tâche. Elle est toujours là.';

  @override
  String get projectListRenameTaskTitle => 'Renommer la tâche';

  @override
  String get projectListRenameTaskField => 'Nom de la tâche';

  @override
  String get projectListRenameTaskEmpty => 'Saisissez un nom pour cette tâche.';

  @override
  String projectListRenameTaskFailed(String title) {
    return 'Impossible de renommer « $title ». Le nom est inchangé.';
  }

  @override
  String projectListNetworkStatusFor(String host, String state) {
    return 'État du réseau pour $host — $state';
  }

  @override
  String projectListSwitchConnection(String host) {
    return 'Changer de connexion — actuelle : $host';
  }

  @override
  String get projectListNoTasks =>
      'Aucune tâche dans ce projet pour l\'instant';

  @override
  String projectListAgentFor(String project) {
    return 'Agent pour $project';
  }

  @override
  String get projectListChangeAgent => 'Changer d\'agent';

  @override
  String get newTaskNoProjects =>
      'Ajoutez d\'abord un projet sur l\'ordinateur, puis réessayez.';

  @override
  String get newTaskProjectLabel => 'Projet';

  @override
  String get newTaskPromptHint => 'Décrivez la tâche';

  @override
  String newTaskCouldNotStart(String detail) {
    return 'Impossible de démarrer cette tâche. $detail';
  }

  @override
  String get composerOptionsHeader => 'Options pour cette tâche';

  @override
  String get composerAgentDefault => 'Défaut de l\'agent';

  @override
  String get composerUse => 'Utiliser';

  @override
  String get composerAgentBare => 'Agent';

  @override
  String composerModelValue(String value) {
    return 'Modèle : $value';
  }

  @override
  String composerModeValue(String value) {
    return 'Mode : $value';
  }

  @override
  String composerThinkingValue(String value) {
    return 'Réflexion : $value';
  }

  @override
  String get projectListSearchHint => 'Rechercher tâches, dépôts, chemins';

  @override
  String get projectListRemoveConfirm => 'Retirer le projet';

  @override
  String projectListNewTaskIn(Object project) {
    return 'Nouvelle tâche dans $project';
  }

  @override
  String get newTaskTitle => 'Nouvelle tâche';

  @override
  String get newTaskSubmitting => 'Ajout…';

  @override
  String get runRemoveTask => 'Retirer la tâche';

  @override
  String get composerDefault => 'Par défaut';

  @override
  String get composerModeSheet => 'Mode';

  @override
  String get composerModeTooltip =>
      'Ce que l\'agent a le droit de faire dans cette tâche';

  @override
  String get composerModelSheet => 'Modèle';

  @override
  String get composerModelTooltip =>
      'Le modèle que l\'agent utilise pour cette tâche';

  @override
  String get composerModelHint => 'fournisseur/modèle';

  @override
  String get composerThinkingSheet => 'Réflexion';

  @override
  String get composerThinkingTooltip =>
      'Combien l\'agent réfléchit avant de répondre';

  @override
  String get taskUntitled => 'Tâche sans titre';

  @override
  String get projectUnknown => 'Projet inconnu';

  @override
  String get statusQueued => 'En attente';

  @override
  String get statusDone => 'Terminé';

  @override
  String get statusFailed => 'Échec';

  @override
  String get statusUnknown => 'Inconnu';

  @override
  String get statusNeedsAnswer => 'Attend votre réponse';

  @override
  String get statusWorking => 'En cours';

  @override
  String get statusIdle => 'Inactif';

  @override
  String get statusStopped => 'Arrêté';
}
