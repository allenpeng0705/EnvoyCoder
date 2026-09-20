/**
 * The **git** sentences of the German catalogue, one namespace of it.
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
  "error.gitNothingStaged": "Es ist nichts bereitgestellt, also gibt es nichts zu committen. Stelle zuerst eine Datei bereit — oder alles.",
  "error.gitMergeConflict": "{branch} kann nicht automatisch gemergt werden. Diese Dateien stehen im Konflikt: {files}. Es wurde nichts geändert — dein Branch und dein Arbeitsverzeichnis sind genau wie vorher.",
  "error.gitPullDiverged": "Der Branch auf dem Rechner und der auf dem Remote haben sich beide geändert, ein Pull kann sie also nicht zusammenbringen. Merge sie, oder pushe deinen Branch.",
  "error.gitNothingToStash": "Es gibt nichts beiseitezulegen — in diesem Ordner hat keine Datei unversionierte Änderungen.",
  "error.gitStashDirty": "Ein Stash lässt sich nur auf einen sauberen Arbeitsbaum zurücklegen. Committe oder stashe zuerst die Änderungen in diesem Ordner.",
  "error.gitStashConflict": "Dieser Stash lässt sich nicht sauber zurücklegen. Diese Dateien stehen im Konflikt: {files}. Es wurde nichts geändert, und der Stash ist noch da.",
  "git.stash.title": "Stashes",
  "git.stash.cta": "Beiseitelegen",
  "git.stash.done": "Beiseitegelegt.",
  "git.stash.pop": "Zurücklegen",
  "git.stash.drop": "Verwerfen",
  "git.stash.confirm": "Diesen Stash verwerfen?",
  "git.stash.empty": "Nichts beiseitegelegt.",
  "git.merge.into": "{branch} in {current} mergen",
  "git.merge.cta": "Merge",
  "git.merge.done": "{branch} in {into} gemergt.",
  "error.gitMergeUnresolved": "Ein Merge ist nicht abgeschlossen: In {files} gibt es noch Konflikte. Löse sie und schließe den Merge ab, oder brich ihn ab.",
  "error.gitMergeNone": "Es läuft kein Merge, also gibt es nichts abzuschließen oder abzubrechen.",
  "error.gitConflicted": "In diesem Repository gibt es ungelöste Konflikte in {files}, aus einem Vorgang, den EnvoyDev nicht gestartet hat. Schließe ihn dort ab oder mache ihn dort rückgängig, bevor du hier etwas anderes tust.",
  "error.gitMergeResolveFailed": "Der Agent konnte nicht gestartet werden, deshalb wurde der Merge zurückgenommen und nichts hat sich geändert: {detail}",
  "git.merge.stopped": "Ein Merge ist mit Konflikten stehen geblieben.",
  "git.merge.stoppedFrom": "Der Merge von {branch} ist mit Konflikten stehen geblieben.",
  "git.merge.resolved": "Alle Konflikte sind gelöst. Schließe den Merge ab, um ihn festzuhalten.",
  "git.merge.resolve": "Mit einem Agenten lösen",
  "git.merge.finish": "Merge abschließen",
  "git.merge.abort": "Merge abbrechen",
  "git.merge.resolving": "Ein Agent löst diesen Merge: {task}.",
  "git.merge.aborted": "Der Merge wurde abgebrochen, es wurde nichts gemergt.",
  "git.merge.recorded": "Der Merge wurde festgehalten.",
  "git.branches.conflictsChip": "Konflikte",
  "git.fetch.nothing": "Gefetcht. Nichts Neues.",
  "git.pull.nothing": "Gepullt. Schon aktuell.",
  "git.fetch.cta": "Fetch",
  "git.fetch.done": "Gefetcht. {summary}",
  "git.pull.cta": "Pull",
  "git.pull.done": "Gepullt. {summary}",
  "error.gitCommitEmpty": "Ein Commit braucht eine Nachricht.",
  "error.gitTimedOut": "Git wurde nicht rechtzeitig fertig, deshalb hat EnvoyDev es gestoppt. Das Repository ist vielleicht sehr groß, oder git wartet auf etwas.",
  "git.branches.title": "Branches",
  "git.branches.aria": "Branches für {project}",
  "git.branches.detachedChip": "Kein Branch",
  "git.branches.detached": "Dieses Repository hat einen losgelösten HEAD, deshalb ist kein Branch aktuell.",
  "git.branches.empty": "Dieses Repository hat noch keine Branches.",
  "git.branches.new": "Neuer Branch",
  "git.branches.name": "Branch-Name",
  "git.branches.create": "Anlegen und wechseln",
  "git.branches.switched": "Zu {branch} gewechselt.",
  "git.branches.created": "{branch} angelegt und dorthin gewechselt.",
  "error.gitMissing": "Git ist auf diesem Rechner nicht installiert, deshalb kann EnvoyDev dieses Repository nicht lesen. Installiere git und versuche es erneut.",
  "error.gitNotARepository": "„{path}“ ist kein Git-Repository. Branches gibt es nur für Ordner, die git verfolgt.",
  "error.gitBusy": "„{title}“ läuft gerade in diesem Projekt. Beende oder stoppe sie, bevor du den Branch wechselst — ein Checkout unter einem arbeitenden Agenten kostet Arbeit.",
  "error.gitFailed": "Git konnte das nicht ausführen: {detail}",
  "error.gitBranchInvalid": "„{name}“ kann kein Branch-Name sein. Erlaubt sind Buchstaben, Ziffern, Punkte, Bindestriche und Schrägstriche, und er darf nicht mit einem Bindestrich beginnen.",
  "error.gitBranchTooLong": "Ein Branch-Name darf höchstens {count} Zeichen lang sein.",
  "error.gitBranchEmpty": "Ein Branch braucht einen Namen.",
} as const;
