/**
 * Typed join paths for paired homes — same three methods the phone offers.
 *
 * Pairing link (QR / paste), host:port + token, and SSH hop + daemon address. A phone that already
 * holds a home can share *only* the method it used; the laptop pastes into the matching tab here
 * when the home machine is not at hand to mint a fresh code.
 */

export type HomeJoinParts =
  | { host: string; port: number; path: string; token: string; label: string; sshHop?: string }
  | { error: string };

export type PhoneShareParts =
  | { method: "link"; uri: string }
  | { method: "direct"; endpoint: string; token: string }
  | {
      method: "ssh";
      sshHost: string;
      sshUser?: string;
      sshPort: string;
      daemonEndpoint: string;
      token: string;
    }
  | { error: string };

/** `host:port` or `[ipv6]:port` — same shape mobile `parseEndpoint` accepts. */
export function parseHostPort(raw: string): { host: string; port: number } | undefined {
  const text = raw.trim();
  if (!text) return undefined;

  const bracketed = /^\[([^\]]+)\]:(\d{1,5})$/.exec(text);
  if (bracketed) {
    const port = Number(bracketed[2]);
    if (!Number.isFinite(port) || port < 1 || port > 65535) return undefined;
    return { host: bracketed[1]!, port };
  }

  const at = text.lastIndexOf(":");
  if (at <= 0 || at === text.length - 1) return undefined;
  const host = text.slice(0, at).trim();
  const port = Number(text.slice(at + 1).trim());
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) return undefined;
  return { host, port };
}

/**
 * What a paired phone's **Share connection** copies — link URI, or `endpoint:` / `sshHost:` lines.
 *
 * Used so the laptop can fill the matching join tab without retyping secrets from the phone.
 */
export function parsePhoneShare(raw: string): PhoneShareParts {
  const text = raw.trim();
  if (!text) return { error: "Paste the connection text the phone shared." };

  if (/^envoy:\/\/pair\b/i.test(text) || text.includes("pairing=")) {
    return { method: "link", uri: text };
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const map = new Map<string, string>();
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (value) map.set(key, value);
  }

  if (map.has("sshhost") || map.has("daemon")) {
    const sshHost = map.get("sshhost");
    const daemon = map.get("daemon");
    const token = map.get("token");
    if (!sshHost) return { error: "That SSH share is missing sshHost." };
    if (!daemon) return { error: "That SSH share is missing daemon." };
    if (!token) return { error: "That SSH share is missing token." };
    return {
      method: "ssh",
      sshHost,
      ...(map.get("sshuser") ? { sshUser: map.get("sshuser") } : {}),
      sshPort: map.get("sshport") ?? "22",
      daemonEndpoint: daemon,
      token,
    };
  }

  if (map.has("endpoint") || map.has("token")) {
    const endpoint = map.get("endpoint");
    const token = map.get("token");
    if (!endpoint) return { error: "That host:port share is missing endpoint." };
    if (!token) return { error: "That host:port share is missing token." };
    return { method: "direct", endpoint, token };
  }

  return { error: "That does not look like a pairing link or a phone share." };
}

/**
 * Direct TCP: address on the network + the token the home minted (required — this laptop is not on
 * the home's loopback).
 */
export function homeFromDirect(input: {
  endpoint: string;
  token: string;
  label?: string;
}): HomeJoinParts {
  const parsed = parseHostPort(input.endpoint);
  if (!parsed) return { error: "Enter the home as host:port (for example 10.0.0.5:4770)." };
  const token = input.token.trim();
  if (!token) {
    return { error: "A pairing token is required. Copy it from the phone or mint one on the home." };
  }
  return {
    host: parsed.host,
    port: parsed.port,
    path: "/ws",
    token,
    label: (input.label?.trim() || parsed.host).slice(0, 64),
  };
}

/**
 * SSH hop + daemon address behind it.
 *
 * Token is required on the desktop: the window dials the daemon WebSocket with the token. When the
 * daemon address is loopback, HomeRegistry opens an SSH local-forward through [sshHop] before dialling
 * (shell `paired_home_ssh_forward`) — same need as the phone's Remote SSH path.
 */
export function homeFromSsh(input: {
  sshHost: string;
  sshPort?: string;
  sshUser?: string;
  daemonEndpoint: string;
  token: string;
  label?: string;
}): HomeJoinParts {
  const hopHost = input.sshHost.trim();
  if (!hopHost) return { error: "Enter the SSH host (the machine you can reach)." };
  const portRaw = (input.sshPort ?? "22").trim();
  const sshPort = Number(portRaw);
  if (!Number.isFinite(sshPort) || sshPort < 1 || sshPort > 65535) {
    return { error: "SSH port must be a number between 1 and 65535." };
  }
  const daemon = parseHostPort(input.daemonEndpoint);
  if (!daemon) {
    return { error: "Enter the daemon as host:port on the far side (often 127.0.0.1:4770)." };
  }
  const token = input.token.trim();
  if (!token) {
    return { error: "A pairing token is required so this laptop can authenticate after the hop." };
  }
  const user = input.sshUser?.trim();
  const sshHop = user ? `${user}@${hopHost}:${sshPort}` : `${hopHost}:${sshPort}`;
  return {
    host: daemon.host,
    port: daemon.port,
    path: "/ws",
    token,
    label: (input.label?.trim() || hopHost).slice(0, 64),
    sshHop,
  };
}
