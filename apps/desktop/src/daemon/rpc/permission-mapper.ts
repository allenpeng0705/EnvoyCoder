/**
 * Map OMP `extension_ui_request` tool approvals onto ACP-shaped permission cards.
 *
 * Reference: Paseo `omp/rpc-ui-permission-mapper.ts` (reimplemented, not vendored).
 */

import type { AcpPermissionRequest } from "../acp/protocol.js"

const TOOL_TITLE_PREFIX = "Allow tool: "
const APPROVE = "Approve"
const DENY = "Deny"

export interface ExtensionUiRequest {
  type: "extension_ui_request"
  id: string
  method?: string
  title?: string
  options?: unknown
}

/** ACP-shaped card for RunManager, plus how to answer OMP. */
export interface MappedOmpPermission {
  request: AcpPermissionRequest
  approveValue: string
  denyValue: string
}

export function mapExtensionUiToPermission(
  event: ExtensionUiRequest,
  sessionId: string,
): MappedOmpPermission | null {
  if (event.method !== "select" || !hasApproveDenyOptions(event.options)) return null
  const title = typeof event.title === "string" ? event.title : ""
  if (!title.startsWith(TOOL_TITLE_PREFIX) && !title.includes(`\n${TOOL_TITLE_PREFIX}`)) {
    const firstLine = title.split(/\r?\n/, 1)[0]?.trim() ?? ""
    if (!firstLine.startsWith(TOOL_TITLE_PREFIX)) return null
  }
  const firstLineBreak = title.search(/\r?\n/)
  const firstLine = (firstLineBreak < 0 ? title : title.slice(0, firstLineBreak)).trim()
  if (!firstLine.startsWith(TOOL_TITLE_PREFIX)) return null
  const toolName = firstLine.slice(TOOL_TITLE_PREFIX.length).trim()
  const body = firstLineBreak < 0 ? "" : title.slice(firstLineBreak).replace(/^\r?\n/, "")
  const description = describeTool(toolName, body)

  return {
    request: {
      sessionId,
      toolCall: {
        toolCallId: event.id,
        title: `Allow tool: ${toolName}`,
        kind: toolName === "bash" ? "execute" : "edit",
      },
      toolName,
      ...(description !== undefined ? { description } : {}),
      // `allow_always` is host-only: OMP's select UI is Approve/Deny. Choosing Always allow still
      // sends Approve over the wire; RunManager sets `sessionAutoAllow` for the rest of the run.
      options: [
        { optionId: "deny", name: DENY, kind: "reject_once" },
        { optionId: "approve", name: APPROVE, kind: "allow_once" },
        { optionId: "allow_always", name: "Always allow", kind: "allow_always" },
      ],
    },
    approveValue: APPROVE,
    denyValue: DENY,
  }
}

export function extensionUiResponseFromOption(
  optionId: string | null,
  mapped: MappedOmpPermission,
): { value?: string; cancelled?: boolean } {
  if (optionId === null) return { cancelled: true }
  if (optionId === "deny") return { value: mapped.denyValue }
  // approve and allow_always both map to OMP's Approve string.
  return { value: mapped.approveValue }
}

function hasApproveDenyOptions(options: unknown): boolean {
  return (
    Array.isArray(options) &&
    options.length === 2 &&
    options[0] === APPROVE &&
    options[1] === DENY
  )
}

function describeTool(toolName: string, body: string): string | undefined {
  switch (toolName) {
    case "bash": {
      const match = /(?:^|\r?\n)[\t ]*Command:[\t ]?(.*)$/s.exec(body)
      return match?.[1] !== undefined ? `Command: ${match[1]}` : undefined
    }
    case "edit": {
      const file = readPrefixed(body.split(/\r?\n/), "File:")
      return file ? `File: ${file}` : undefined
    }
    case "write": {
      const path = readPrefixed(body.split(/\r?\n/), "Path:")
      return path ? `Path: ${path}` : undefined
    }
    default:
      return body.trim() || undefined
  }
}

function readPrefixed(lines: readonly string[], prefix: string): string | undefined {
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith(prefix)) {
      const value = trimmed.slice(prefix.length).trim()
      if (value) return value
    }
  }
  return undefined
}
