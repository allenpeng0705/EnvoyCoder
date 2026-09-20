/**
 * "There is no project called …" — one refusal, one shape.
 *
 * Extracted so the git service can refuse an unknown project with the **same** code, sentence and key as
 * the rest of the table: the two sentences are per-*noun* on purpose (German, French and Italian inflect
 * "project" and "task" differently, so a single template with the noun substituted in would be wrong in
 * exactly the languages the catalogue exists for), and a second copy of that reasoning is how the two
 * would come to disagree.
 */

import { ENVOYDEV_ERRORS, coderError } from "@envoydev/protocol";

import { ref } from "./messages.js";

export function notFound(kind: "project" | "task", id: string): Error {
  const sentence =
    `There is no ${kind} called "${id}" on this machine. It may have been removed from another window.`;
  // The code follows the noun too, for the same reason the key does: a caller that has just been told
  // its project is gone and one that has been told its task is gone do different things next.
  return coderError(
    kind === "project" ? ENVOYDEV_ERRORS.projectMissing : ENVOYDEV_ERRORS.taskMissing,
    sentence,
    kind === "project"
      ? ref("error.projectNotFound", { id })
      : ref("error.taskNotFound", { id }),
  );
}
