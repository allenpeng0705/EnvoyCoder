/**
 * Member-side inbound offer / cancel / approval handlers (M5).
 *
 * Split from `collab-handlers.ts` for the family line budget.
 */

import {
  ENVOYDEV_ERRORS,
  type StepOffer,
  coderError,
  parseRpcParams,
  shouldAutoAccept,
} from "@envoydev/protocol";

import type { CollabDeps } from "./collab-deps.js";
import { maybeStartLocalRun, peerCall } from "./collab-runtime.js";
import {
  getInboundOffer,
  listMemberships,
  listPendingInboundOffers,
  patchInboundOffer,
  saveInboundOffer,
  type InboundOfferRecord,
} from "./memberships.js";
import {
  reportJobStepProgress,
  resolveCwdHint,
  readOffers,
  getJob,
} from "./jobs.js";
import { requireTeam, memberTokenMatches } from "./teams.js";
import { requireTeamToken } from "./collab-auth.js";
import { requireOwnerWindow } from "./pairing.js";
import { normalizeWsUrl } from "./team-invite.js";
import { ref } from "./messages.js";

type CollabCallContext = { session: unknown };
type CollabHandler = (params: unknown, context: CollabCallContext) => Promise<unknown>;

async function cancelStartedRun(deps: CollabDeps, runId: string | undefined): Promise<void> {
  if (!runId || !deps.runs) return;
  try {
    await deps.runs.cancel(runId);
  } catch {
    /* best-effort — orphan is worse if we also throw away the primary error */
  }
}

export function createCollabInboundHandlers(deps: CollabDeps): Partial<Record<string, CollabHandler>> {
  return {
    "coder.inboundJobStepOffer": async (params) => {
      const input = parseRpcParams("coder.inboundJobStepOffer", params) as {
        offer: StepOffer;
        originWs: string;
        teamToken: string;
      };
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === input.offer.teamId && m.token === input.teamToken,
      );
      if (!membership) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "This machine is not a member of that team.",
          ref("error.team.unknownMember"),
        );
      }
      if (membership.memberId !== input.offer.assigneeMemberId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer is for a different member.",
          ref("error.team.unknownMember"),
        );
      }
      // Always phone home to the membership's origin — never trust caller-supplied originWs.
      const originWs = normalizeWsUrl(membership.originWs);
      const claimedOrigin = normalizeWsUrl(input.originWs);
      if (claimedOrigin !== originWs) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That origin does not match this membership.",
          ref("error.team.badToken"),
        );
      }
      const existing = await getInboundOffer(deps.paths.inboundJobOffersFile, input.offer.offerId);
      if (existing && existing.status !== "pending") {
        // Redelivery must not rewind an accepted/refused/cancelled offer.
        const status =
          existing.status === "accepted"
            ? ("accepted" as const)
            : ("refused" as const);
        return {
          received: true as const,
          status,
          ...(existing.runId ? { runId: existing.runId } : {}),
          ...(existing.taskId ? { taskId: existing.taskId } : {}),
          ...(existing.policy || existing.status === "cancelled"
            ? { policy: existing.policy ?? existing.status }
            : {}),
        };
      }
      const record: InboundOfferRecord = {
        ...input.offer,
        originWs,
        teamToken: input.teamToken,
        receivedAt: new Date().toISOString(),
      };
      await saveInboundOffer(deps.paths.inboundJobOffersFile, record);

      if (shouldAutoAccept(membership.acceptPolicy, input.offer.role)) {
        const resolved = await resolveCwdHint(input.offer.cwdHint);
        if (!resolved.ok) {
          await peerCall(deps)({
            url: record.originWs,
            method: "coder.refuseJobStepOffer",
            params: {
              offerId: record.offerId,
              policy: resolved.policy,
              memberId: membership.memberId,
              teamToken: membership.token,
              memberToken: membership.memberToken,
              cancelNonce: record.cancelNonce,
            },
          });
          await patchInboundOffer(deps.paths.inboundJobOffersFile, record.offerId, {
            status: "refused",
            policy: resolved.policy,
          });
          return { received: true as const, status: "refused" as const, policy: resolved.policy };
        }
        const started = await maybeStartLocalRun(deps, record, resolved.path, undefined, {
          originWs: record.originWs,
          teamToken: membership.token,
          memberToken: membership.memberToken,
        });
        if (deps.runs && !started) {
          await peerCall(deps)({
            url: record.originWs,
            method: "coder.refuseJobStepOffer",
            params: {
              offerId: record.offerId,
              policy: "harness-failed",
              memberId: membership.memberId,
              teamToken: membership.token,
              memberToken: membership.memberToken,
              cancelNonce: record.cancelNonce,
            },
          });
          await patchInboundOffer(deps.paths.inboundJobOffersFile, record.offerId, {
            status: "refused",
            policy: "harness-failed",
          });
          return { received: true as const, status: "refused" as const, policy: "harness-failed" };
        }
        if (!started) {
          // No runs wired — cannot accept without a runId on the pre-auth path.
          await peerCall(deps)({
            url: record.originWs,
            method: "coder.refuseJobStepOffer",
            params: {
              offerId: record.offerId,
              policy: "harness-unavailable",
              memberId: membership.memberId,
              teamToken: membership.token,
              memberToken: membership.memberToken,
              cancelNonce: record.cancelNonce,
            },
          });
          await patchInboundOffer(deps.paths.inboundJobOffersFile, record.offerId, {
            status: "refused",
            policy: "harness-unavailable",
          });
          return { received: true as const, status: "refused" as const, policy: "harness-unavailable" };
        }
        const accepted = await peerCall(deps)({
          url: record.originWs,
          method: "coder.acceptJobStepOffer",
          params: {
            offerId: record.offerId,
            resolvedCwd: resolved.path,
            runId: started.runId,
            memberId: membership.memberId,
            teamToken: membership.token,
            memberToken: membership.memberToken,
            cancelNonce: record.cancelNonce,
          },
        });
        if (!accepted.ok) {
          await cancelStartedRun(deps, started.runId);
          await patchInboundOffer(deps.paths.inboundJobOffersFile, record.offerId, {
            status: "refused",
            policy: "origin-accept-failed",
          });
          return {
            received: true as const,
            status: "refused" as const,
            policy: "origin-accept-failed",
          };
        }
        await patchInboundOffer(deps.paths.inboundJobOffersFile, record.offerId, {
          status: "accepted",
          runId: started.runId,
          taskId: started.taskId,
        });
        return {
          received: true as const,
          status: "accepted" as const,
          runId: started.runId,
          taskId: started.taskId,
        };
      }
      return { received: true as const, status: "pending" as const };
    },
    "coder.listInboundJobOffers": async (params) => {
      parseRpcParams("coder.listInboundJobOffers", params);
      const offers = await listPendingInboundOffers(deps.paths.inboundJobOffersFile);
      return {
        offers: offers.map(({ teamToken: _t, cancelNonce: _n, ...rest }) => rest),
      };
    },
    "coder.acceptInboundJobStepOffer": async (params, context) => {
      requireOwnerWindow(context, "coder.acceptInboundJobStepOffer");
      const input = parseRpcParams("coder.acceptInboundJobStepOffer", params) as {
        offerId: string;
        resolvedCwd: string;
      };
      const offer = await getInboundOffer(deps.paths.inboundJobOffersFile, input.offerId);
      if (!offer || offer.status !== "pending") {
        throw coderError(ENVOYDEV_ERRORS.badRequest, "No pending inbound offer.", ref("error.job.offerMissing"));
      }
      const resolved = await resolveCwdHint(input.resolvedCwd);
      if (!resolved.ok) {
        throw coderError(
          ENVOYDEV_ERRORS.peerRefused,
          "Path missing on this machine.",
          ref("error.job.pathMissing"),
        );
      }
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === offer.teamId,
      );
      if (!membership?.memberToken) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "This machine is not a member of that team.",
          ref("error.team.unknownMember"),
        );
      }
      if (!offer.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "That offer is missing cancel proof.",
          ref("error.job.offerMissing"),
        );
      }
      const started = await maybeStartLocalRun(deps, offer, resolved.path, undefined, {
        originWs: offer.originWs,
        teamToken: offer.teamToken,
        memberToken: membership.memberToken,
      });
      if (!started) {
        throw coderError(
          ENVOYDEV_ERRORS.peerRefused,
          "Could not start a run for that step.",
          ref("error.job.pathMissing"),
        );
      }
      const remote = await peerCall(deps)<{ offerId: string; status: "accepted"; runId?: string }>({
        url: offer.originWs,
        method: "coder.acceptJobStepOffer",
        params: {
          offerId: offer.offerId,
          resolvedCwd: resolved.path,
          runId: started.runId,
          memberId: offer.assigneeMemberId,
          teamToken: offer.teamToken,
          memberToken: membership.memberToken,
          cancelNonce: offer.cancelNonce,
        },
      });
      if (!remote.ok) {
        await cancelStartedRun(deps, started.runId);
        throw coderError(ENVOYDEV_ERRORS.badRequest, remote.message, ref("error.job.offerClosed"));
      }
      await patchInboundOffer(deps.paths.inboundJobOffersFile, offer.offerId, {
        status: "accepted",
        runId: started.runId,
        taskId: started.taskId,
      });
      return {
        offerId: offer.offerId,
        status: "accepted" as const,
        runId: started.runId,
        taskId: started.taskId,
      };
    },
    "coder.refuseInboundJobStepOffer": async (params, context) => {
      requireOwnerWindow(context, "coder.refuseInboundJobStepOffer");
      const input = parseRpcParams("coder.refuseInboundJobStepOffer", params) as {
        offerId: string;
        policy: string;
      };
      const offer = await getInboundOffer(deps.paths.inboundJobOffersFile, input.offerId);
      if (!offer || offer.status !== "pending") {
        throw coderError(ENVOYDEV_ERRORS.badRequest, "No pending inbound offer.", ref("error.job.offerMissing"));
      }
      if (!offer.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "That offer is missing cancel proof.",
          ref("error.job.offerMissing"),
        );
      }
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === offer.teamId,
      );
      if (!membership?.memberToken) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "This machine is not a member of that team.",
          ref("error.team.unknownMember"),
        );
      }
      const remote = await peerCall(deps)({
        url: offer.originWs,
        method: "coder.refuseJobStepOffer",
        params: {
          offerId: offer.offerId,
          policy: input.policy,
          memberId: offer.assigneeMemberId,
          teamToken: offer.teamToken,
          memberToken: membership.memberToken,
          cancelNonce: offer.cancelNonce,
        },
      });
      if (!remote.ok) {
        throw coderError(ENVOYDEV_ERRORS.badRequest, remote.message, ref("error.job.offerClosed"));
      }
      await patchInboundOffer(deps.paths.inboundJobOffersFile, offer.offerId, {
        status: "refused",
        policy: input.policy,
      });
      return { offerId: offer.offerId, status: "refused" as const, policy: input.policy };
    },
    "coder.reportJobStepProgress": async (params) => {
      const input = parseRpcParams("coder.reportJobStepProgress", params) as {
        jobId: string;
        stepId: string;
        memberId: string;
        teamToken: string;
        memberToken: string;
        runId?: string;
        runPhase?: import("@envoydev/protocol").RunPhase;
        lastEventAt?: string;
        blocked?: import("@envoydev/protocol").BlockReason;
        outcome?: "succeeded" | "failed" | "cancelled";
        error?: string;
        ledgerMessage?: string;
        eventSeq?: number;
        approvalRequestId?: string;
      };
      const job = await getJob(deps.paths.jobsFile, input.jobId);
      await requireTeamToken(deps.paths.teamsFile, job.teamId, input.teamToken);
      const team = await requireTeam(deps.paths.teamsFile, job.teamId);
      const member = team.members.find((m) => m.id === input.memberId);
      if (!member || !memberTokenMatches(member, input.memberToken)) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That member token is not valid.",
          ref("error.team.badToken"),
        );
      }
      const next = await reportJobStepProgress(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        input,
      );
      return { ok: true as const, job: next };
    },
    "coder.listTeamMemberships": async (params) => {
      parseRpcParams("coder.listTeamMemberships", params);
      const memberships = await listMemberships(deps.paths.membershipsFile);
      return {
        memberships: memberships.map((m) => ({
          teamId: m.teamId,
          memberId: m.memberId,
          label: m.label,
          teamLabel: m.teamLabel,
          rolesOffered: m.rolesOffered,
          acceptPolicy: m.acceptPolicy,
          joinedAt: m.joinedAt,
          originWs: m.originWs,
          // Token stays daemon-side — never list plaintext to clients (phone included).
        })),
      };
    },
    "coder.listJobOffers": async (params) => {
      const input = parseRpcParams("coder.listJobOffers", params) as { jobId: string };
      const offers = await readOffers(deps.paths.jobOffersFile);
      return {
        offers: Object.values(offers.offers)
          .filter((o) => o.jobId === input.jobId)
          .map(({ cancelNonce: _n, ...rest }) => rest),
      };
    },
    "coder.cancelInboundJobStep": async (params) => {
      const input = parseRpcParams("coder.cancelInboundJobStep", params) as {
        offerId: string;
        runId?: string;
        teamId: string;
        teamToken: string;
        cancelNonce: string;
        reason?: string;
      };
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === input.teamId && m.token === input.teamToken,
      );
      if (!membership) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "This machine is not a member of that team.",
          ref("error.team.unknownMember"),
        );
      }
      const offer = await getInboundOffer(deps.paths.inboundJobOffersFile, input.offerId);
      if (!offer || offer.teamId !== input.teamId) {
        return { cancelled: false, runCancelled: false };
      }
      // cancelNonce was minted with the offer on origin — team token alone is not enough.
      if (!offer.cancelNonce || offer.cancelNonce !== input.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That cancel proof is not valid for this offer.",
          ref("error.team.badToken"),
        );
      }
      let runCancelled = false;
      const boundRunId = offer.runId;
      if (input.runId && boundRunId && input.runId !== boundRunId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That run is not bound to this offer.",
          ref("error.team.badToken"),
        );
      }
      const runId = boundRunId ?? input.runId;
      if (runId && deps.runs) {
        runCancelled = await deps.runs.cancel(runId);
      }
      await patchInboundOffer(deps.paths.inboundJobOffersFile, input.offerId, {
        status: "cancelled",
        policy: input.reason ?? "orchestrator-stop",
      });
      return { cancelled: true, runCancelled };
    },
    "coder.answerInboundJobStepApproval": async (params) => {
      const input = parseRpcParams("coder.answerInboundJobStepApproval", params) as {
        offerId: string;
        runId: string;
        requestId: string;
        optionId: string;
        teamId: string;
        teamToken: string;
        cancelNonce: string;
      };
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === input.teamId && m.token === input.teamToken,
      );
      if (!membership) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "This machine is not a member of that team.",
          ref("error.team.unknownMember"),
        );
      }
      if (!deps.runs) {
        return { answered: false, alreadyResolved: true };
      }
      const offer = await getInboundOffer(deps.paths.inboundJobOffersFile, input.offerId);
      if (!offer || offer.teamId !== input.teamId) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "No inbound offer with that id.",
          ref("error.job.offerMissing"),
        );
      }
      if (!offer.cancelNonce || offer.cancelNonce !== input.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer proof is not valid.",
          ref("error.team.badToken"),
        );
      }
      const bound = offer.runId ?? offer.pendingApproval?.runId;
      if (!bound) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "That offer has no live run to approve.",
          ref("error.job.notRunning"),
        );
      }
      if (bound !== input.runId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That run is not bound to this offer.",
          ref("error.team.badToken"),
        );
      }
      if (offer.pendingApproval && offer.pendingApproval.requestId !== input.requestId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That approval request is not pending for this offer.",
          ref("error.team.badToken"),
        );
      }
      const answered = await deps.runs.answerApproval(bound, input.requestId, input.optionId);
      await patchInboundOffer(deps.paths.inboundJobOffersFile, input.offerId, {
        pendingApproval: undefined,
      });
      return { answered, alreadyResolved: !answered };
    },

  };
}
