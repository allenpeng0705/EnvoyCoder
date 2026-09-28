import { describe, expect, it } from "vitest";

import { homeFromDirect, homeFromSsh, parseHostPort, parsePhoneShare } from "../src/state/home-join.js";

describe("parseHostPort", () => {
  it("parses ipv4 and bracketed ipv6", () => {
    expect(parseHostPort("10.0.0.5:4770")).toEqual({ host: "10.0.0.5", port: 4770 });
    expect(parseHostPort("[::1]:4770")).toEqual({ host: "::1", port: 4770 });
    expect(parseHostPort("bad")).toBeUndefined();
  });
});

describe("homeFromDirect", () => {
  it("requires endpoint and token", () => {
    expect(homeFromDirect({ endpoint: "10.0.0.5:4770", token: "secret99" })).toMatchObject({
      host: "10.0.0.5",
      port: 4770,
      token: "secret99",
    });
    expect(homeFromDirect({ endpoint: "x", token: "secret99" })).toMatchObject({ error: expect.any(String) });
    expect(homeFromDirect({ endpoint: "10.0.0.5:4770", token: "  " })).toMatchObject({ error: expect.any(String) });
  });
});

describe("homeFromSsh", () => {
  it("builds hop string and daemon endpoint", () => {
    expect(
      homeFromSsh({
        sshHost: "bastion",
        sshUser: "me",
        sshPort: "22",
        daemonEndpoint: "127.0.0.1:4770",
        token: "tokentok",
      }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 4770,
      sshHop: "me@bastion:22",
      token: "tokentok",
    });
  });
});

describe("parsePhoneShare", () => {
  it("recognises a pairing link", () => {
    const uri = "envoy://pair?wsUrl=ws%3A%2F%2F10.0.0.1%3A4770%2Fws&token=abc&ownerId=o&app=EnvoyDev";
    expect(parsePhoneShare(uri)).toEqual({ method: "link", uri });
  });

  it("recognises direct and ssh share blocks from the phone", () => {
    expect(
      parsePhoneShare("endpoint: 10.0.0.9:4770\ntoken: MyPhone99"),
    ).toEqual({ method: "direct", endpoint: "10.0.0.9:4770", token: "MyPhone99" });
    expect(
      parsePhoneShare("sshHost: bastion\nsshUser: me\nsshPort: 22\ndaemon: 127.0.0.1:4770\ntoken: secrettok"),
    ).toMatchObject({
      method: "ssh",
      sshHost: "bastion",
      sshUser: "me",
      daemonEndpoint: "127.0.0.1:4770",
      token: "secrettok",
    });
  });
});
