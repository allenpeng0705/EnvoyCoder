/**
 * Work Engine RPC handlers — wired when `deps.work` is set on the daemon.
 */

import { parseRpcParams, type RpcMethod } from "@envoydev/protocol";

import type { CoderCallContext, CoderHandler } from "./service.js";
import type { WorkEngine } from "./work-engine.js";

export function createWorkHandlers(deps: { engine: WorkEngine }): Partial<Record<RpcMethod, CoderHandler>> {
  const { engine } = deps;
  return {
    "work.listTickets": async (params) => {
      const input = parseRpcParams("work.listTickets", params) as
        | { projectId?: string; includeEnded?: boolean }
        | undefined;
      return { tickets: engine.listTickets(input ?? {}) };
    },

    "work.getTicket": async (params) => {
      const { id } = parseRpcParams("work.getTicket", params) as { id: string };
      return { ticket: engine.getTicket(id) };
    },

    "work.createTicket": async (params) => {
      const input = parseRpcParams("work.createTicket", params) as {
        title: string;
        projectId?: string;
        taskId?: string;
        scope?: string;
      };
      return { ticket: await engine.createTicket(input) };
    },

    "work.promoteTask": async (params) => {
      const input = parseRpcParams("work.promoteTask", params) as { taskId: string; title?: string };
      return { ticket: await engine.promoteTask(input) };
    },

    "work.stopTicket": async (params) => {
      const input = parseRpcParams("work.stopTicket", params) as { id: string; reason?: string };
      return { ticket: await engine.stopTicket(input) };
    },

    "work.retryTicket": async (params) => {
      const { id } = parseRpcParams("work.retryTicket", params) as { id: string };
      return { ticket: await engine.retryTicket({ id }) };
    },

    "work.answerAttention": async (params) => {
      const input = parseRpcParams("work.answerAttention", params) as { id: string; text: string };
      return { ticket: await engine.answerAttention(input) };
    },

    "work.getPolicy": async (params) => {
      parseRpcParams("work.getPolicy", params);
      return { policy: engine.getPolicy() };
    },

    "work.setPolicy": async (params) => {
      const input = parseRpcParams("work.setPolicy", params) as {
        acceptMode?: "off" | "observe" | "auto";
        allowList?: string[];
        requireApprovalsForUnattended?: boolean;
        enabled?: boolean;
      };
      return { policy: await engine.setPolicy(input) };
    },

    "work.listAttention": async (params) => {
      const input = parseRpcParams("work.listAttention", params) as { projectId?: string } | undefined;
      return { tickets: engine.listAttention(input ?? {}) };
    },

    "work.enqueueCandidate": async (params) => {
      const input = parseRpcParams("work.enqueueCandidate", params) as {
        text: string;
        strength?: "explicit" | "inferred";
        sourceKind?: "manual" | "github";
      };
      return { candidate: await engine.enqueueCandidate(input) };
    },

    "work.listCandidates": async (params) => {
      parseRpcParams("work.listCandidates", params);
      return { candidates: engine.listCandidates() };
    },

    "work.triageCandidate": async (params) => {
      const input = parseRpcParams("work.triageCandidate", params) as {
        id: string;
        assessmentAccepts?: boolean;
      };
      return engine.triageCandidate(input);
    },

    "work.listEffects": async (params) => {
      const input = parseRpcParams("work.listEffects", params) as { pendingOnly?: boolean } | undefined;
      return { effects: engine.listEffects(input ?? {}) };
    },

    "work.report": async (params) => {
      const input = parseRpcParams("work.report", params) as {
        ticketId: string;
        kind: "progress" | "waiting" | "ready" | "blocked" | "failed" | "dropped";
        note?: string;
      };
      return { ticket: await engine.report(input) };
    },

    "work.githubPoll": async (params) => {
      const input = parseRpcParams("work.githubPoll", params) as { repo?: string } | undefined;
      return engine.githubPoll(input ?? {});
    },

    "work.githubReply": async (params) => {
      const input = parseRpcParams("work.githubReply", params) as {
        threadKey: string;
        body: string;
        purpose?: string;
      };
      return engine.githubReply(input);
    },
  };
}
