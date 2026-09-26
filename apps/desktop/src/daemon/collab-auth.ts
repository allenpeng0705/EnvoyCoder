/**
 * Team-token checks for pre-auth collab mutators.
 *
 * Pre-auth methods skip transport auth, so every mutator that changes offers or
 * accept policy must prove the team token in params — omitting it is a refusal,
 * not an open door (`docs/envoydev-collaboration.md` §4).
 */

import { ENVOYDEV_ERRORS, coderError } from "@envoydev/protocol";

import { ref } from "./messages.js";
import { liveTeamTokenPlain } from "./teams.js";

/**
 * Refuse when `teamToken` is missing, does not match, or the team token is expired.
 */
export async function requireTeamToken(
  teamsFile: string,
  teamId: string,
  teamToken: string | undefined,
): Promise<string> {
  if (typeof teamToken !== "string" || teamToken.trim().length < 16) {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "A team token is required for this action.",
      ref("error.team.badToken"),
    );
  }
  const expected = await liveTeamTokenPlain(teamsFile, teamId);
  if (!expected) {
    throw coderError(
      ENVOYDEV_ERRORS.teamExpired,
      "That team token is no longer valid.",
      ref("error.team.expired"),
    );
  }
  if (expected !== teamToken) {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "That team token is not valid.",
      ref("error.team.badToken"),
    );
  }
  return expected;
}
