import { describe, expect, it } from "vitest"

import {
  isAcpRetriableLeakError,
  isAcpRetriableLeakText,
  isAcpToolRunnerFailure,
  stripAcpRetriableLeak,
  textFromAcpToolContent,
  toolPayloadFromAcpUpdate,
} from "../src/daemon/acp/retriable-leak.js"

describe("stripAcpRetriableLeak", () => {
  it("drops a whole RetriableError / WritableIterable chunk", () => {
    expect(stripAcpRetriableLeak("Error: RetriableError: WritableIterable is closed")).toEqual({
      kept: "",
      leaked: true,
    })
    expect(isAcpRetriableLeakText("Error: RetriableError: WritableIterable is closed")).toBe(true)
  })

  it("strips a trailing leak after a real answer", () => {
    expect(
      stripAcpRetriableLeak("PONG\n\nError: RetriableError: WritableIterable is closed"),
    ).toEqual({ kept: "PONG", leaked: true })
  })

  it("recognizes ConnectError and the generic server blurb", () => {
    expect(stripAcpRetriableLeak("Error: ConnectError: [unavailable] boom")).toEqual({
      kept: "",
      leaked: true,
    })
    expect(
      stripAcpRetriableLeak("hi\n\nSomething went wrong communicating with the server. Please try again."),
    ).toEqual({ kept: "hi", leaked: true })
  })

  it("recognizes Service temporarily unavailable (whole and trailing)", () => {
    expect(stripAcpRetriableLeak("Service temporarily unavailable")).toEqual({
      kept: "",
      leaked: true,
    })
    expect(isAcpRetriableLeakText("Service temporarily unavailable.")).toBe(true)
    expect(stripAcpRetriableLeak("partial answer\n\nService temporarily unavailable")).toEqual({
      kept: "partial answer",
      leaked: true,
    })
    expect(isAcpRetriableLeakError(new Error("Service temporarily unavailable"))).toBe(true)
  })

  it("leaves ordinary assistant text alone", () => {
    expect(stripAcpRetriableLeak("here is the answer")).toEqual({
      kept: "here is the answer",
      leaked: false,
    })
  })

  it("classifies thrown RetriableError messages", () => {
    expect(isAcpRetriableLeakError(new Error("RetriableError: WritableIterable is closed"))).toBe(
      true,
    )
    expect(isAcpRetriableLeakError(new Error("disk full"))).toBe(false)
  })
})

describe("isAcpToolRunnerFailure", () => {
  it("flattens ACP tool content shapes", () => {
    expect(textFromAcpToolContent("Service temporarily unavailable")).toBe(
      "Service temporarily unavailable",
    )
    expect(
      textFromAcpToolContent([
        { type: "content", content: { type: "text", text: "Service temporarily unavailable" } },
      ]),
    ).toBe("Service temporarily unavailable")
    expect(
      textFromAcpToolContent([
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ]),
    ).toBe("hello world")
  })

  it("recognizes unavailable / ConnectError tool payloads", () => {
    expect(isAcpToolRunnerFailure("Service temporarily unavailable")).toBe(true)
    expect(
      isAcpToolRunnerFailure([
        { type: "content", content: { type: "text", text: "Error: ConnectError: [unavailable]" } },
      ]),
    ).toBe(true)
    expect(isAcpToolRunnerFailure("Error: RetriableError: WritableIterable is closed")).toBe(true)
  })

  it("does not treat ordinary stdout or bare empty as a blip", () => {
    expect(isAcpToolRunnerFailure("file-a\nfile-b")).toBe(false)
    expect(isAcpToolRunnerFailure("")).toBe(false)
    expect(isAcpToolRunnerFailure(undefined)).toBe(false)
    expect(
      isAcpToolRunnerFailure([
        { type: "content", content: { type: "text", text: "ok" } },
      ]),
    ).toBe(false)
    // Substring only — must not classify real logs that mention the phrase.
    expect(
      isAcpToolRunnerFailure("log: Service temporarily unavailable then recovered\nok"),
    ).toBe(false)
  })

  it("prefers content, else Cursor rawOutput stdout", () => {
    expect(
      toolPayloadFromAcpUpdate({
        content: [],
        rawOutput: { stdout: "file-a\n", stderr: "", exitCode: 0 },
      }),
    ).toEqual({ stdout: "file-a\n", stderr: "", exitCode: 0 })
    expect(
      textFromAcpToolContent({ stdout: "file-a\n", stderr: "", exitCode: 0 }),
    ).toContain("file-a")
    expect(
      toolPayloadFromAcpUpdate({
        content: [{ type: "text", text: "keep" }],
        rawOutput: { stdout: "ignored" },
      }),
    ).toEqual([{ type: "text", text: "keep" }])
  })
})
