/**
 * The **git** sentences of the French catalogue, one namespace of it.
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
  "error.gitNothingStaged": "Rien n'est indexé, il n'y a donc rien à committer. Indexez d'abord un fichier — ou tout.",
  "error.gitMergeConflict": "{branch} ne peut pas être fusionnée automatiquement. Ces fichiers sont en conflit : {files}. Rien n'a été modifié — votre branche et votre arbre de travail sont exactement comme avant.",
  "error.gitPullDiverged": "La branche sur l'ordinateur et celle du dépôt distant ont toutes deux changé : un pull ne peut pas les réunir. Fusionnez-les, ou poussez votre branche.",
  "error.gitNothingToStash": "Il n'y a rien à remiser — aucun fichier de ce dossier n'a de modification non validée.",
  "error.gitStashDirty": "Remettre un stash en place exige une copie de travail propre. Validez ou remisez d'abord les modifications de ce dossier.",
  "error.gitStashConflict": "Ce stash ne peut pas être remis en place proprement. Ces fichiers sont en conflit : {files}. Rien n'a été modifié, et le stash est toujours là.",
  "git.stash.title": "Remisages",
  "git.stash.cta": "Remiser",
  "git.stash.done": "Remisé.",
  "git.stash.pop": "Remettre en place",
  "git.stash.drop": "Supprimer",
  "git.stash.confirm": "Supprimer ce stash ?",
  "git.stash.empty": "Rien de remisé.",
  "git.merge.into": "Fusionner {branch} dans {current}",
  "git.merge.cta": "Fusionner",
  "git.merge.done": "{branch} fusionnée dans {into}.",
  "error.gitMergeUnresolved": "Une fusion n'est pas terminée : {files} a encore des conflits. Résolvez-les et terminez la fusion, ou annulez-la.",
  "error.gitMergeNone": "Aucune fusion n'est en cours : il n'y a rien à terminer ni à annuler.",
  "error.gitConflicted": "Ce dépôt a des conflits non résolus dans {files}, venant d'une opération qu'EnvoyDev n'a pas lancée. Terminez-la ou annulez-la là-bas avant de faire autre chose ici.",
  "error.gitMergeResolveFailed": "L'agent n'a pas pu démarrer : la fusion a donc été annulée et rien n'a changé : {detail}",
  "git.merge.stopped": "Une fusion s'est arrêtée sur des conflits.",
  "git.merge.stoppedFrom": "La fusion de {branch} s'est arrêtée sur des conflits.",
  "git.merge.resolved": "Tous les conflits sont résolus. Terminez la fusion pour l'enregistrer.",
  "git.merge.resolve": "Résoudre avec un agent",
  "git.merge.finish": "Terminer la fusion",
  "git.merge.abort": "Annuler la fusion",
  "git.merge.resolving": "Un agent résout cette fusion : {task}.",
  "git.merge.aborted": "La fusion a été annulée, et rien n'a été fusionné.",
  "git.merge.recorded": "La fusion a été enregistrée.",
  "git.branches.conflictsChip": "Conflits",
  "git.fetch.nothing": "R\u00e9cup\u00e9r\u00e9. Rien de nouveau.",
  "git.pull.nothing": "Tir\u00e9. D\u00e9j\u00e0 \u00e0 jour.",
  "git.fetch.cta": "Récupérer",
  "git.fetch.done": "Récupéré. {summary}",
  "git.pull.cta": "Tirer",
  "git.pull.done": "Tiré. {summary}",
  "error.gitCommitEmpty": "Un commit a besoin d'un message.",
  "error.gitTimedOut": "Git n'a pas terminé à temps, donc EnvoyDev l'a arrêté. Le dépôt est peut-être très volumineux, ou git attend quelque chose.",
  "git.branches.title": "Branches",
  "git.branches.aria": "Branches de {project}",
  "git.branches.detachedChip": "Aucune branche",
  "git.branches.detached": "Ce dépôt a un HEAD détaché, donc aucune branche n'est active.",
  "git.branches.empty": "Ce dépôt n'a pas encore de branche.",
  "git.branches.new": "Nouvelle branche",
  "git.branches.name": "Nom de branche",
  "git.branches.create": "Créer et basculer",
  "git.branches.switched": "Basculé sur {branch}.",
  "git.branches.created": "{branch} créée, et basculé dessus.",
  "error.gitMissing": "Git n'est pas installé sur cette machine, donc EnvoyDev ne peut pas lire ce dépôt. Installez git et réessayez.",
  "error.gitNotARepository": "« {path} » n'est pas un dépôt git. Les branches n'existent que pour les dossiers suivis par git.",
  "error.gitBusy": "« {title} » est en cours dans ce projet. Terminez-la ou arrêtez-la avant de changer de branche — un checkout sous un agent au travail fait perdre du travail.",
  "error.gitFailed": "Git n'a pas pu le faire : {detail}",
  "error.gitBranchInvalid": "« {name} » ne peut pas être un nom de branche. Les lettres, chiffres, points, tirets et barres obliques sont acceptés, et il ne peut pas commencer par un tiret.",
  "error.gitBranchTooLong": "Un nom de branche peut faire au plus {count} caractères.",
  "error.gitBranchEmpty": "Une branche a besoin d'un nom.",
} as const;
