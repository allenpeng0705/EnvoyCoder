import { describe, expect, it } from "vitest"

import {
  isAcpRetriableLeakError,
  isAcpRetriableLeakText,
  stripAcpRetriableLeak,
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
