/**
 * The **git** sentences of the Italian catalogue, one namespace of it.
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
  "error.gitNothingStaged": "Non c'è nulla in stage, quindi non c'è niente da committare. Metti prima un file in stage — o tutto.",
  "error.gitMergeConflict": "{branch} non può essere unito automaticamente. Questi file sono in conflitto: {files}. Non è stato cambiato nulla — il branch e il working tree sono esattamente come prima.",
  "error.gitPullDiverged": "Il branch sul computer e quello sul remoto sono cambiati entrambi, quindi un pull non può unirli. Uniscili, oppure pusha il tuo branch.",
  "error.gitNothingToStash": "Non c'è niente da mettere da parte — nessun file in questa cartella ha modifiche non committate.",
  "error.gitStashDirty": "Per rimettere a posto uno stash serve un albero di lavoro pulito. Committa o metti da parte prima le modifiche in questa cartella.",
  "error.gitStashConflict": "Questo stash non può essere rimesso a posto in modo pulito. Questi file sono in conflitto: {files}. Non è stato cambiato nulla e lo stash è ancora lì.",
  "git.stash.title": "Stash",
  "git.stash.cta": "Metti da parte",
  "git.stash.done": "Messo da parte.",
  "git.stash.pop": "Rimetti a posto",
  "git.stash.drop": "Elimina",
  "git.stash.confirm": "Eliminare questo stash?",
  "git.stash.empty": "Nessuno stash.",
  "git.merge.into": "Unisci {branch} in {current}",
  "git.merge.cta": "Unisci",
  "git.merge.done": "{branch} unito in {into}.",
  "error.gitMergeUnresolved": "Un merge non è concluso: in {files} ci sono ancora conflitti. Risolvili e concludi il merge, oppure annullalo.",
  "error.gitMergeNone": "Non c'è nessun merge in corso, quindi non c'è nulla da concludere o annullare.",
  "error.gitConflicted": "Questo repository ha conflitti non risolti in {files}, da un'operazione che EnvoyDev non ha avviato. Concludila o annullala lì prima di fare altro qui.",
  "error.gitMergeResolveFailed": "L'agente non è potuto partire, quindi il merge è stato annullato e nulla è cambiato: {detail}",
  "git.merge.stopped": "Un merge si è fermato con dei conflitti.",
  "git.merge.stoppedFrom": "Il merge di {branch} si è fermato con dei conflitti.",
  "git.merge.resolved": "Tutti i conflitti sono risolti. Concludi il merge per registrarlo.",
  "git.merge.resolve": "Risolvi con un agente",
  "git.merge.finish": "Concludi il merge",
  "git.merge.abort": "Annulla il merge",
  "git.merge.resolving": "Un agente sta risolvendo questo merge: {task}.",
  "git.merge.aborted": "Il merge è stato annullato e non è stato unito nulla.",
  "git.merge.recorded": "Il merge è stato registrato.",
  "git.branches.conflictsChip": "Conflitti",
  "git.fetch.nothing": "Scaricato. Niente di nuovo.",
  "git.pull.nothing": "Aggiornato. Gi\u00e0 tutto aggiornato.",
  "git.fetch.cta": "Fetch",
  "git.fetch.done": "Scaricato. {summary}",
  "git.pull.cta": "Pull",
  "git.pull.done": "Aggiornato. {summary}",
  "error.gitCommitEmpty": "Un commit ha bisogno di un messaggio.",
  "error.gitTimedOut": "Git non ha finito in tempo, quindi EnvoyDev lo ha fermato. Il repository è forse molto grande, oppure git sta aspettando qualcosa.",
  "git.branches.title": "Branch",
  "git.branches.aria": "Branch di {project}",
  "git.branches.detachedChip": "Nessun branch",
  "git.branches.detached": "Questo repository ha un HEAD staccato, quindi nessun branch è attivo.",
  "git.branches.empty": "Questo repository non ha ancora branch.",
  "git.branches.new": "Nuovo branch",
  "git.branches.name": "Nome del branch",
  "git.branches.create": "Crea e passa",
  "git.branches.switched": "Passato a {branch}.",
  "git.branches.created": "{branch} creato, e passato lì.",
  "error.gitMissing": "Git non è installato su questa macchina, quindi EnvoyDev non può leggere questo repository. Installa git e riprova.",
  "error.gitNotARepository": "«{path}» non è un repository git. I branch esistono solo per le cartelle che git segue.",
  "error.gitBusy": "«{title}» è in esecuzione in questo progetto. Finiscila o fermala prima di cambiare branch — un checkout sotto un agente al lavoro fa perdere lavoro.",
  "error.gitFailed": "Git non ha potuto farlo: {detail}",
  "error.gitBranchInvalid": "«{name}» non può essere un nome di branch. Sono ammessi lettere, cifre, punti, trattini e barre, e non può iniziare con un trattino.",
  "error.gitBranchTooLong": "Un nome di branch può avere al massimo {count} caratteri.",
  "error.gitBranchEmpty": "Un branch ha bisogno di un nome.",
} as const;
