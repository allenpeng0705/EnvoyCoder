/**
 * The **Background service** sentences of the French catalogue, one namespace of it.
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
  "settings.service.title": "Service en arrière-plan",
  "settings.service.detail": "Exécute le démon comme service pour qu'un téléphone joigne cette machine fenêtre fermée.",
  "settings.service.state.notInstalled.title": "Désactivé",
  "settings.service.state.notInstalled.detail": "Votre téléphone ne peut joindre cette machine que tant que la fenêtre EnvoyDev est ouverte.",
  "settings.service.state.running.title": "Activé, en cours",
  "settings.service.state.running.atLogin": "Le service tourne et redémarrera à l'ouverture de votre session.",
  "settings.service.state.running.notAtLogin": "Le service tourne, mais il n'est pas configuré pour démarrer à l'ouverture de votre session.",
  "settings.service.state.running.plain": "Le service tourne actuellement.",
  "settings.service.state.installedStopped.title": "Activé, arrêté",
  "settings.service.state.installedStopped.atLogin": "Il est installé et démarrera à l'ouverture de votre session.",
  "settings.service.state.installedStopped.notAtLogin": "Il est installé, mais pas configuré pour démarrer à l'ouverture de votre session.",
  "settings.service.state.installedStopped.plain": "Il est installé mais ne tourne pas pour le moment.",
  "settings.service.state.failed.title": "Un problème est survenu",
  "settings.service.state.failed.detail": "Le service n'a pas pu démarrer. Ce que le gestionnaire de services de votre système a répondu figure ci-dessous.",
  "settings.service.state.unsupported.title": "Indisponible ici",
  "settings.service.state.unsupported.detail": "EnvoyDev n'a trouvé aucun gestionnaire de services utilisable sur ce système. L'application fonctionne toujours tant que la fenêtre est ouverte.",
  "settings.service.state.unknown.title": "Impossible à déterminer",
  "settings.service.state.unknown.detail": "EnvoyDev n'a pas pu lire l'état du service auprès du gestionnaire de services du système.",
  "settings.service.pid": "Processus {pid}.",
  "settings.service.checking": "Interrogation du gestionnaire de services de votre système…",
  "settings.service.restarts.one": "Redémarré une fois dans la dernière heure",
  "settings.service.restarts.many": "Redémarré {count} fois dans la dernière heure",
  "settings.service.lastStop.requested": "Dernier arrêt : demandé via la connexion, à {when}",
  "settings.service.lastStop.refused": "Dernier arrêt : service refusé puis quitté, à {when}",
  "settings.service.lastStop.failed": "Dernier arrêt : échec du service puis sortie, à {when}",
  "settings.service.lastStop.signal": "Dernier arrêt : {signal}, à {when}",
  "settings.service.lastStop.signalExit": "Dernier arrêt : {signal} (code de sortie {code}), à {when}",
  "settings.service.lastStop.crash": "Aucune demande d'arrêt n'a précédé ce démarrage — le démon précédent a été tué ou a planté",
  "settings.service.action.turnOn": "Activer",
  "settings.service.action.restart": "Redémarrer",
  "settings.service.action.stop": "Arrêter",
  "settings.service.action.stop.title": "Arrêter le démon maintenant. Le service étant installé, il redémarrera à votre prochaine connexion.",
  "settings.service.action.stop.title.notAtLogin": "Arrêter le démon maintenant. Le service est installé, mais il n'est pas configuré pour démarrer à l'ouverture de votre session.",
  "settings.service.action.stop.title.plain": "Arrêter le démon maintenant. Le service reste installé ; Désactiver le supprime.",
  "settings.service.action.turnOff.title": "Supprimer le service, pour que le démon ne redémarre plus.",
  "settings.service.stopVsOff": "Arrêter le termine maintenant ; Désactiver supprime le service pour qu'il reste éteint.",
  "settings.service.action.turnOff": "Désactiver",
  "settings.service.action.tryAgain": "Réessayer",
  "settings.service.action.refresh": "Actualiser",
  "settings.service.busy": "En cours…",
};
