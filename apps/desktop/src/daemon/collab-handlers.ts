/**
 * M5 team / job RPC handlers — join across daemons, offer delivery, real runs.
 *
 * Kept beside `service.ts` so the main table stays under the family's line budget
 * while still sharing the same deps bag.
 */

import {
  ENVOYDEV_ERRORS,
  type AcceptPolicy,
  type JobRole,
  coderError,
  parseRpcParams,
} from "@envoydev/protocol";

import {
  listMemberships,
  saveMembership,
  updateMembershipAcceptPolicy,
} from "./memberships.js";
import {
  startMembershipHeartbeats,
  type MembershipHeartbeat,
} from "./membership-heartbeat.js";
import {
  acceptJobStepOffer,
  cancelJobsForTeam,
  cancelWorkForMember,
  createJob,
  evaluateStalls,
  evaluateDeadlines,
  failJobStep,
  getJob,
  listJobs,
  offerJobStep,
  pauseJob,
  reassignJobStep,
  refuseJobStepOffer,
  setJobStallAutomation,
  startJob,
  stopJob,
  stopJobStep,
  suggestJobSteps,
  updateJobSteps,
  readOffers,
} from "./jobs.js";
import {
  buildMemberStatusBoard,
  createTeam,
  dissolveTeam,
  joinTeam,
  kickMember,
  listTeams,
  refreshConnectionStatuses,
  requireTeam,
  rotateTeamToken,
  setMemberAcceptPolicy,
  teamHeartbeat,
  teamTokenPlain,
  toPublic,
  memberTokenMatches,
} from "./teams.js";
import {
  inviteNeedsRemoteJoin,
  normalizeWsUrl,
  parseTeamInvite,
} from "./team-invite.js";
import { requireOwnerWindow } from "./pairing.js";
import { requireTeamToken } from "./collab-auth.js";
import { configureLocalAutoAccept, configureOfferDelivery } from "./offer-delivery.js";
import { configureJobsChanged } from "./jobs.js";
import { configureRemoteStepCancel } from "./job-progress.js";
import { createCollabInboundHandlers } from "./collab-inbound.js";
import { ref } from "./messages.js";

/** Same shape as `CoderCallContext` — kept local to avoid a service ↔ collab import cycle. */
type CollabCallContext = { session: unknown };
type CollabHandler = (params: unknown, context: CollabCallContext) => Promise<unknown>;

export type { CollabDeps } from "./collab-deps.js";
import type { CollabDeps } from "./collab-deps.js";

/** Lazy heartbeat so unit tests that only build handlers still get beats after join. */
const heartbeatByFile = new Map<string, MembershipHeartbeat>();

function membershipHeartbeatOf(deps: CollabDeps): MembershipHeartbeat {
  if (deps.membershipHeartbeat) return deps.membershipHeartbeat;
  const key = deps.paths.membershipsFile;
  let hb = heartbeatByFile.get(key);
  if (!hb) {
    hb = startMembershipHeartbeats({
      membershipsFile: key,
      ...(deps.callPeer ? { callPeer: deps.callPeer } : {}),
    });
    heartbeatByFile.set(key, hb);
  }
  return hb;
}

import {
  cancelRemoteWork,
  deliverOfferToMember,
  maybeStartLocalRun,
  originWsForInvite,
  peerCall,
  selfHostHint,
  selfWsUrls,
} from "./collab-runtime.js";

export function createCollabHandlers(deps: CollabDeps): Partial<Record<string, CollabHandler>> {
  configureOfferDelivery(deps.paths.teamsFile, async (offer, hostHints, teamToken) => {
    await deliverOfferToMember(deps, offer, hostHints, teamToken);
  });
  configureLocalAutoAccept(deps.paths.teamsFile, async (offer, resolvedCwd) => {
    const job = await getJob(deps.paths.jobsFile, offer.jobId);
    const started = await maybeStartLocalRun(deps, offer, resolvedCwd, job.projectId);
    return started ? { runId: started.runId } : undefined;
  });
  configureJobsChanged(deps.paths.jobsFile, deps.onJobsChanged ?? null);
  configureRemoteStepCancel(deps.paths.jobsFile, async (job, stepId) => {
    await cancelRemoteWork(deps, job, stepId);
  });

  return {
    "coder.createTeam": async (params, context) => {
      requireOwnerWindow(context, "coder.createTeam");
      const input = parseRpcParams("coder.createTeam", params) as {
        label: string;
        ttlHours?: number;
      };
      return createTeam(deps.paths.teamsFile, {
        ...input,
        originWs: originWsForInvite(deps),
      });
    },
    "coder.listTeams": async (params) => {
      parseRpcParams("coder.listTeams", params);
      await refreshConnectionStatuses(deps.paths.teamsFile);
      const teams = await listTeams(deps.paths.teamsFile);
      return { teams };
    },
    "coder.teamStatus": async (params) => {
      const input = parseRpcParams("coder.teamStatus", params) as { teamId: string };
      await refreshConnectionStatuses(deps.paths.teamsFile);
      const team = await requireTeam(deps.paths.teamsFile, input.teamId);
      const jobs = await listJobs(deps.paths.jobsFile, { teamId: input.teamId });
      return { team: toPublic(team), board: buildMemberStatusBoard(team, jobs) };
    },
    "coder.rotateTeamToken": async (params, context) => {
      requireOwnerWindow(context, "coder.rotateTeamToken");
      const input = parseRpcParams("coder.rotateTeamToken", params) as {
        teamId: string;
        ttlHours?: number;
      };
      return rotateTeamToken(deps.paths.teamsFile, input.teamId, {
        ...(input.ttlHours !== undefined ? { ttlHours: input.ttlHours } : {}),
        originWs: originWsForInvite(deps),
      });
    },
    "coder.dissolveTeam": async (params, context) => {
      requireOwnerWindow(context, "coder.dissolveTeam");
      const input = parseRpcParams("coder.dissolveTeam", params) as { teamId: string };
      await cancelJobsForTeam(deps.paths.jobsFile, deps.paths.jobOffersFile, input.teamId);
      await dissolveTeam(deps.paths.teamsFile, input.teamId);
      return { dissolved: true as const };
    },
    "coder.joinTeam": async (params) => {
      const input = parseRpcParams("coder.joinTeam", params) as {
        token: string;
        label: string;
        rolesOffered?: JobRole[];
        hostHints?: string;
      };
      let invite;
      try {
        invite = parseTeamInvite(input.token);
      } catch (error) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          error instanceof Error ? error.message : "That team token is not valid.",
          ref("error.team.badToken"),
        );
      }
      const self = selfWsUrls(deps);
      if (inviteNeedsRemoteJoin(invite, self)) {
        const hostHints = input.hostHints ?? selfHostHint(deps);
        const remote = await peerCall(deps)<{
          teamId: string;
          memberId: string;
          team: { id: string; label: string };
          memberToken: string;
        }>({
          url: invite.originWs,
          method: "coder.joinTeam",
          params: {
            token: invite.token,
            label: input.label,
            ...(input.rolesOffered ? { rolesOffered: input.rolesOffered } : {}),
            hostHints,
          },
          timeoutMs: 12_000,
        });
        if (!remote.ok) {
          throw coderError(
            ENVOYDEV_ERRORS.unauthorized,
            remote.message,
            ref("error.team.badToken"),
          );
        }
        await saveMembership(deps.paths.membershipsFile, {
          teamId: remote.result.teamId,
          memberId: remote.result.memberId,
          label: input.label,
          teamLabel: remote.result.team.label,
          token: invite.token,
          memberToken: remote.result.memberToken,
          originWs: normalizeWsUrl(invite.originWs),
          rolesOffered: input.rolesOffered ?? ["implement", "review"],
          acceptPolicy: { mode: "manual" },
          joinedAt: new Date().toISOString(),
        });
        void membershipHeartbeatOf(deps).beatNow();
        return remote.result;
      }
      // Local / origin-side join (bare token or invite pointing at this daemon).
      return joinTeam(deps.paths.teamsFile, {
        token: invite.token,
        label: input.label,
        ...(input.rolesOffered ? { rolesOffered: input.rolesOffered } : {}),
        ...(input.hostHints !== undefined ? { hostHints: input.hostHints } : {}),
      });
    },
    "coder.teamHeartbeat": async (params) => {
      const input = parseRpcParams("coder.teamHeartbeat", params) as {
        teamId: string;
        memberId: string;
        token: string;
        memberToken: string;
        acceptPolicy?: AcceptPolicy;
      };
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === input.teamId && m.memberId === input.memberId,
      );
      if (membership) {
        // Pre-auth: never forward stored secrets unless the caller already proved them.
        if (input.token !== membership.token || input.memberToken !== membership.memberToken) {
          throw coderError(
            ENVOYDEV_ERRORS.unauthorized,
            "That member token is not valid.",
            ref("error.team.badToken"),
          );
        }
        const remote = await peerCall(deps)<{ ok: true; connection: unknown }>({
          url: membership.originWs,
          method: "coder.teamHeartbeat",
          params: {
            teamId: input.teamId,
            memberId: input.memberId,
            token: membership.token,
            memberToken: membership.memberToken,
            acceptPolicy: membership.acceptPolicy,
          },
        });
        if (!remote.ok) {
          throw coderError(ENVOYDEV_ERRORS.teamExpired, remote.message, ref("error.team.expired"));
        }
        return remote.result;
      }
      const connection = await teamHeartbeat(deps.paths.teamsFile, input);
      return { ok: true as const, connection };
    },
    "coder.getTeamToken": async (params, context) => {
      requireOwnerWindow(context, "coder.getTeamToken");
      const input = parseRpcParams("coder.getTeamToken", params) as { teamId: string };
      const token = await teamTokenPlain(deps.paths.teamsFile, input.teamId);
      if (!token) {
        throw coderError(
          ENVOYDEV_ERRORS.teamMissing,
          "No team with that id.",
          ref("error.team.missing"),
        );
      }
      return { teamId: input.teamId, token };
    },
    /**
     * Not pre-auth: loopback / paired session only.
     * Member machines update the local membership row; origin learns via heartbeat `acceptPolicy`.
     * Origin owner sets roster rows (including `local`) here directly.
     */
    "coder.setMemberAcceptPolicy": async (params, context) => {
      requireOwnerWindow(context, "coder.setMemberAcceptPolicy");
      const input = parseRpcParams("coder.setMemberAcceptPolicy", params) as {
        teamId: string;
        memberId: string;
        acceptPolicy: AcceptPolicy;
      };
      const membership = (await listMemberships(deps.paths.membershipsFile)).find(
        (m) => m.teamId === input.teamId && m.memberId === input.memberId,
      );
      if (membership) {
        await updateMembershipAcceptPolicy(
          deps.paths.membershipsFile,
          input.teamId,
          input.acceptPolicy,
        );
        // Push immediately so origin does not wait for the next 15s beat.
        await peerCall(deps)({
          url: membership.originWs,
          method: "coder.teamHeartbeat",
          params: {
            teamId: membership.teamId,
            memberId: membership.memberId,
            token: membership.token,
            memberToken: membership.memberToken,
            acceptPolicy: input.acceptPolicy,
          },
        });
        return {
          member: {
            ...membership,
            id: membership.memberId,
            joinedAt: membership.joinedAt,
            connection: { status: "online", transport: "lan" },
            hostHints: selfHostHint(deps),
            acceptPolicy: input.acceptPolicy,
          },
        };
      }
      const member = await setMemberAcceptPolicy(deps.paths.teamsFile, input);
      return { member };
    },
    "coder.kickMember": async (params, context) => {
      requireOwnerWindow(context, "coder.kickMember");
      const input = parseRpcParams("coder.kickMember", params) as {
        teamId: string;
        memberId: string;
      };
      const jobs = await listJobs(deps.paths.jobsFile, { teamId: input.teamId });
      for (const job of jobs) {
        for (const step of job.steps) {
          if (
            step.assigneeMemberId === input.memberId &&
            (step.status === "running" || step.status === "offered")
          ) {
            await cancelRemoteWork(deps, job, step.id);
          }
        }
      }
      await cancelWorkForMember(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        input.teamId,
        input.memberId,
      );
      await kickMember(deps.paths.teamsFile, input.teamId, input.memberId);
      return { kicked: true as const };
    },
    "coder.createJob": async (params, context) => {
      requireOwnerWindow(context, "coder.createJob");
      const input = parseRpcParams("coder.createJob", params) as {
        teamId: string;
        title: string;
        goal: string;
        projectId?: string;
        steps?: import("./jobs.js").JobStepDraft[];
        policy?: Partial<import("@envoydev/protocol").FailurePolicy>;
      };
      await requireTeam(deps.paths.teamsFile, input.teamId);
      const job = await createJob(deps.paths.jobsFile, input);
      return { job };
    },
    "coder.listJobs": async (params) => {
      const input = parseRpcParams("coder.listJobs", params) as {
        teamId?: string;
        projectId?: string;
      };
      const jobs = await listJobs(deps.paths.jobsFile, input);
      return { jobs };
    },
    "coder.getJob": async (params) => {
      const input = parseRpcParams("coder.getJob", params) as { jobId: string };
      let job = await getJob(deps.paths.jobsFile, input.jobId);
      if (job.status === "running") {
        job = await evaluateDeadlines(
          deps.paths.jobsFile,
          deps.paths.jobOffersFile,
          deps.paths.teamsFile,
          job.id,
        );
        if (job.stallPolicy.automationEnabled) {
          job = await evaluateStalls(
            deps.paths.jobsFile,
            deps.paths.jobOffersFile,
            deps.paths.teamsFile,
            job.id,
          );
        }
      }
      return { job };
    },
    "coder.updateJobSteps": async (params, context) => {
      requireOwnerWindow(context, "coder.updateJobSteps");
      const input = parseRpcParams("coder.updateJobSteps", params) as {
        jobId: string;
        steps: import("./jobs.js").JobStepDraft[];
      };
      const job = await updateJobSteps(deps.paths.jobsFile, input.jobId, input.steps);
      return { job };
    },
    "coder.startJob": async (params, context) => {
      requireOwnerWindow(context, "coder.startJob");
      const input = parseRpcParams("coder.startJob", params) as { jobId: string };
      const job = await startJob(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        input.jobId,
      );
      // Offers created during start are delivered inside offerJobStep.
      return { job: await getJob(deps.paths.jobsFile, job.id) };
    },
    "coder.pauseJob": async (params, context) => {
      requireOwnerWindow(context, "coder.pauseJob");
      const input = parseRpcParams("coder.pauseJob", params) as { jobId: string };
      const job = await pauseJob(deps.paths.jobsFile, input.jobId);
      return { job };
    },
    "coder.stopJob": async (params, context) => {
      requireOwnerWindow(context, "coder.stopJob");
      const input = parseRpcParams("coder.stopJob", params) as { jobId: string };
      const before = await getJob(deps.paths.jobsFile, input.jobId);
      await cancelRemoteWork(deps, before);
      const job = await stopJob(deps.paths.jobsFile, deps.paths.jobOffersFile, input.jobId);
      return { job };
    },
    "coder.offerJobStep": async (params, context) => {
      requireOwnerWindow(context, "coder.offerJobStep");
      const input = parseRpcParams("coder.offerJobStep", params) as {
        jobId: string;
        stepId: string;
        memberId?: string;
      };
      // Remote delivery + local harness auto-accept are wired via offer-delivery hooks.
      return offerJobStep(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        input,
      );
    },
    "coder.acceptJobStepOffer": async (params) => {
      const input = parseRpcParams("coder.acceptJobStepOffer", params) as {
        offerId: string;
        resolvedCwd: string;
        runId: string;
        memberId: string;
        teamToken: string;
        memberToken: string;
        cancelNonce: string;
      };
      const offers = await readOffers(deps.paths.jobOffersFile);
      const existing = offers.offers[input.offerId];
      if (!existing) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "No offer with that id.",
          ref("error.job.offerMissing"),
        );
      }
      await requireTeamToken(deps.paths.teamsFile, existing.teamId, input.teamToken);
      // Pre-auth surface: never accept origin-local work (LAN peers share session===undefined).
      if (existing.assigneeMemberId === "local" || input.memberId === "local") {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "Local offers must be accepted on this machine.",
          ref("error.ownerWindowOnly"),
        );
      }
      if (input.memberId !== existing.assigneeMemberId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer is for a different member.",
          ref("error.team.unknownMember"),
        );
      }
      const team = await requireTeam(deps.paths.teamsFile, existing.teamId);
      const member = team.members.find((m) => m.id === input.memberId);
      if (!member || !memberTokenMatches(member, input.memberToken)) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That member token is not valid.",
          ref("error.team.badToken"),
        );
      }
      if (!existing.cancelNonce || existing.cancelNonce !== input.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer proof is not valid.",
          ref("error.team.badToken"),
        );
      }
      return acceptJobStepOffer(deps.paths.jobsFile, deps.paths.jobOffersFile, {
        offerId: input.offerId,
        resolvedCwd: input.resolvedCwd,
        runId: input.runId,
      });
    },
    "coder.refuseJobStepOffer": async (params) => {
      const input = parseRpcParams("coder.refuseJobStepOffer", params) as {
        offerId: string;
        policy: string;
        memberId: string;
        teamToken: string;
        memberToken: string;
        cancelNonce: string;
      };
      const offers = await readOffers(deps.paths.jobOffersFile);
      const existing = offers.offers[input.offerId];
      if (!existing) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "No offer with that id.",
          ref("error.job.offerMissing"),
        );
      }
      await requireTeamToken(deps.paths.teamsFile, existing.teamId, input.teamToken);
      if (existing.assigneeMemberId === "local" || input.memberId === "local") {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "Local offers must be refused on this machine.",
          ref("error.ownerWindowOnly"),
        );
      }
      if (input.memberId !== existing.assigneeMemberId) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer is for a different member.",
          ref("error.team.unknownMember"),
        );
      }
      const team = await requireTeam(deps.paths.teamsFile, existing.teamId);
      const member = team.members.find((m) => m.id === input.memberId);
      if (!member || !memberTokenMatches(member, input.memberToken)) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That member token is not valid.",
          ref("error.team.badToken"),
        );
      }
      if (!existing.cancelNonce || existing.cancelNonce !== input.cancelNonce) {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer proof is not valid.",
          ref("error.team.badToken"),
        );
      }
      const result = await refuseJobStepOffer(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        input,
      );
      return { offerId: result.offerId, status: result.status, policy: result.policy };
    },
    "coder.acceptLocalJobStepOffer": async (params, context) => {
      requireOwnerWindow(context, "coder.acceptLocalJobStepOffer");
      const input = parseRpcParams("coder.acceptLocalJobStepOffer", params) as {
        offerId: string;
        resolvedCwd: string;
      };
      const offers = await readOffers(deps.paths.jobOffersFile);
      const existing = offers.offers[input.offerId];
      if (!existing) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "No offer with that id.",
          ref("error.job.offerMissing"),
        );
      }
      if (existing.assigneeMemberId !== "local") {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer is not for this machine.",
          ref("error.team.unknownMember"),
        );
      }
      if (!deps.runs) {
        throw coderError(
          ENVOYDEV_ERRORS.peerRefused,
          "Could not start a run for that step.",
          ref("error.job.pathMissing"),
        );
      }
      const job = await getJob(deps.paths.jobsFile, existing.jobId);
      const started = await maybeStartLocalRun(deps, existing, input.resolvedCwd, job.projectId);
      if (!started) {
        throw coderError(
          ENVOYDEV_ERRORS.peerRefused,
          "Could not start a run for that step.",
          ref("error.job.pathMissing"),
        );
      }
      return acceptJobStepOffer(deps.paths.jobsFile, deps.paths.jobOffersFile, {
        offerId: input.offerId,
        resolvedCwd: input.resolvedCwd,
        runId: started.runId,
      });
    },
    "coder.refuseLocalJobStepOffer": async (params, context) => {
      requireOwnerWindow(context, "coder.refuseLocalJobStepOffer");
      const input = parseRpcParams("coder.refuseLocalJobStepOffer", params) as {
        offerId: string;
        policy: string;
      };
      const offers = await readOffers(deps.paths.jobOffersFile);
      const existing = offers.offers[input.offerId];
      if (!existing) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          "No offer with that id.",
          ref("error.job.offerMissing"),
        );
      }
      if (existing.assigneeMemberId !== "local") {
        throw coderError(
          ENVOYDEV_ERRORS.unauthorized,
          "That offer is not for this machine.",
          ref("error.team.unknownMember"),
        );
      }
      const result = await refuseJobStepOffer(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        { offerId: input.offerId, policy: input.policy },
      );
      return { offerId: result.offerId, status: result.status, policy: result.policy };
    },
    "coder.stopJobStep": async (params, context) => {
      requireOwnerWindow(context, "coder.stopJobStep");
      const input = parseRpcParams("coder.stopJobStep", params) as {
        jobId: string;
        stepId: string;
        reason?: string;
      };
      const before = await getJob(deps.paths.jobsFile, input.jobId);
      const { missedAcks } = await cancelRemoteWork(deps, before, input.stepId);
      const step = before.steps.find((s) => s.id === input.stepId);
      if (deps.runs && step?.resultRef && (step.assigneeMemberId === "local" || !step.assigneeMemberId)) {
        await deps.runs.cancel(step.resultRef);
      }
      const reason =
        missedAcks > 0 && before.stallPolicy.onStopIgnored === "abandon-and-reassign"
          ? "stop-ignored"
          : input.reason;
      const job = await stopJobStep(deps.paths.jobsFile, deps.paths.jobOffersFile, {
        ...input,
        ...(reason ? { reason } : {}),
      });
      if (missedAcks > 0 && before.stallPolicy.onStopIgnored === "abandon-and-reassign") {
        try {
          await reassignJobStep(
            deps.paths.jobsFile,
            deps.paths.jobOffersFile,
            deps.paths.teamsFile,
            {
              jobId: input.jobId,
              stepId: input.stepId,
              excludeMemberIds: new Set(step?.assigneeMemberId ? [step.assigneeMemberId] : []),
            },
          );
        } catch {
          /* exhausted */
        }
        return { job: await getJob(deps.paths.jobsFile, input.jobId) };
      }
      return { job };
    },
    "coder.reassignJobStep": async (params, context) => {
      requireOwnerWindow(context, "coder.reassignJobStep");
      const input = parseRpcParams("coder.reassignJobStep", params) as {
        jobId: string;
        stepId: string;
        memberId?: string;
      };
      const before = await getJob(deps.paths.jobsFile, input.jobId);
      await cancelRemoteWork(deps, before, input.stepId);
      const step = before.steps.find((s) => s.id === input.stepId);
      if (deps.runs && step?.resultRef && (step.assigneeMemberId === "local" || !step.assigneeMemberId)) {
        await deps.runs.cancel(step.resultRef);
      }
      const result = await reassignJobStep(
        deps.paths.jobsFile,
        deps.paths.jobOffersFile,
        deps.paths.teamsFile,
        input,
      );
      // Delivery of the new offer is inside offerJobStep.
      return { job: result.job, offer: result.offer };
    },
    "coder.failJobStep": async (params, context) => {
      requireOwnerWindow(context, "coder.failJobStep");
      const input = parseRpcParams("coder.failJobStep", params) as {
        jobId: string;
        stepId: string;
        reason?: string;
      };
      const before = await getJob(deps.paths.jobsFile, input.jobId);
      await cancelRemoteWork(deps, before, input.stepId);
      const job = await failJobStep(
        deps.paths.jobsFile,
        input.jobId,
        input.stepId,
        input.reason ?? "force-fail",
      );
      return { job };
    },
    "coder.suggestJobSteps": async (params, context) => {
      requireOwnerWindow(context, "coder.suggestJobSteps");
      const input = parseRpcParams("coder.suggestJobSteps", params) as {
        jobId: string;
        hint?: string;
      };
      const job = await getJob(deps.paths.jobsFile, input.jobId);
      return suggestJobSteps(job, input.hint);
    },
    "coder.setJobStallAutomation": async (params, context) => {
      requireOwnerWindow(context, "coder.setJobStallAutomation");
      const input = parseRpcParams("coder.setJobStallAutomation", params) as {
        jobId: string;
        enabled: boolean;
      };
      const job = await setJobStallAutomation(deps.paths.jobsFile, input.jobId, input.enabled);
      return { job };
    },
    ...createCollabInboundHandlers(deps),
    "coder.answerJobStepApproval": async (params) => {
      const input = parseRpcParams("coder.answerJobStepApproval", params) as {
        jobId: string;
        stepId: string;
        requestId: string;
        optionId: string;
      };
      const job = await getJob(deps.paths.jobsFile, input.jobId);
      const step = job.steps.find((s) => s.id === input.stepId);
      if (!step?.resultRef) {
        return { answered: false, alreadyResolved: true };
      }
      // Local run on origin.
      if (
        deps.runs &&
        (step.assigneeMemberId === "local" || !step.assigneeMemberId)
      ) {
        const answered = await deps.runs.answerApproval(step.resultRef, input.requestId, input.optionId);
        return { answered, alreadyResolved: !answered };
      }
      // Remote: dial the assignee and answer on their daemon (§7.7 first-wins).
      const team = await requireTeam(deps.paths.teamsFile, job.teamId);
      const member = team.members.find((m) => m.id === step.assigneeMemberId);
      if (!member?.hostHints) {
        return { answered: false, alreadyResolved: true };
      }
      const token = await teamTokenPlain(deps.paths.teamsFile, job.teamId);
      if (!token) {
        return { answered: false, alreadyResolved: true };
      }
      const dial = await (await import("./member-dial.js")).dialMember({
        memberId: member.id,
        hostHints: member.hostHints,
      });
      const endpoint = dial.connection.endpoint ?? member.hostHints;
      if (!dial.reachable || !endpoint) {
        return { answered: false, alreadyResolved: true };
      }
      const lastAttempt = step.attempts[step.attempts.length - 1];
      const offerId = lastAttempt?.offerId;
      if (!offerId) {
        return { answered: false, alreadyResolved: true };
      }
      const offers = await readOffers(deps.paths.jobOffersFile);
      const offer = offers.offers[offerId];
      if (!offer?.cancelNonce) {
        return { answered: false, alreadyResolved: true };
      }
      const remote = await peerCall(deps)<{ answered: boolean; alreadyResolved: boolean }>({
        url: endpoint,
        method: "coder.answerInboundJobStepApproval",
        params: {
          offerId,
          runId: step.resultRef,
          requestId: input.requestId,
          optionId: input.optionId,
          teamId: job.teamId,
          teamToken: token,
          cancelNonce: offer.cancelNonce,
        },
      });
      if (!remote.ok) {
        return { answered: false, alreadyResolved: true };
      }
      return remote.result;
    },
  };
}

/** Methods a peer may call without a pairing token (team token / offer proof instead). */
export const COLLAB_PRE_AUTH_METHODS = [
  "coder.joinTeam",
  "coder.teamHeartbeat",
  "coder.inboundJobStepOffer",
  "coder.acceptJobStepOffer",
  "coder.refuseJobStepOffer",
  "coder.reportJobStepProgress",
  "coder.cancelInboundJobStep",
  "coder.answerInboundJobStepApproval",
] as const;
