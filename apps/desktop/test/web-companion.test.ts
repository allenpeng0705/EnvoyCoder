import { afterEach, describe, expect, it } from "vitest";

import {
  COMPANION_TOKEN_HEADER,
  companionOriginOk,
  companionTokenOk,
  startWebCompanion,
  type WebCompanionHandle,
} from "../src/daemon/web-companion.js";

describe("companionOriginOk / companionTokenOk", () => {
  it("accepts loopback Origin for the bound port", () => {
    expect(
      companionOriginOk(
        { headers: { origin: "http://127.0.0.1:18794" } } as never,
        18794,
      ),
    ).toBe(true);
    expect(
      companionOriginOk({ headers: { origin: "http://evil.example" } } as never, 18794),
    ).toBe(false);
  });

  it("requires an exact token header", () => {
    expect(
      companionTokenOk({ headers: { [COMPANION_TOKEN_HEADER]: "abc" } } as never, "abc"),
    ).toBe(true);
    expect(
      companionTokenOk({ headers: { [COMPANION_TOKEN_HEADER]: "nope" } } as never, "abc"),
    ).toBe(false);
    expect(companionTokenOk({ headers: {} } as never, "abc")).toBe(false);
  });
});

describe("startWebCompanion", () => {
  let handle: WebCompanionHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("serves HTML with the token and rejects unauthenticated answer", async () => {
    handle = await startWebCompanion({
      store: { tasks: () => [] } as never,
      runs: {
        companionSnapshot: () => [],
        answerApproval: async () => true,
      } as never,
      port: 0,
      token: "test-token",
    });

    const page = await fetch(`http://127.0.0.1:${handle.port}/`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("test-token");

    const forbidden = await fetch(`http://127.0.0.1:${handle.port}/api/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "r", requestId: "q", choice: "allow" }),
    });
    expect(forbidden.status).toBe(403);

    const badJson = await fetch(`http://127.0.0.1:${handle.port}/api/answer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [COMPANION_TOKEN_HEADER]: "test-token",
      },
      body: "{",
    });
    expect(badJson.status).toBe(400);

    const okStatus = await fetch(`http://127.0.0.1:${handle.port}/api/status`, {
      headers: { [COMPANION_TOKEN_HEADER]: "test-token" },
    });
    expect(okStatus.status).toBe(200);
    expect(await okStatus.json()).toEqual({ runs: [] });
  });
});
