/**
 * The daemon's persisted mesh identity: the file is written, the key is stable across loads, and two
 * homes are two identities.
 *
 * ## Why this file exists
 *
 * `mesh-peer.ts` used to pass `libp2pPrivateKeyPath`, an option `@envoymesh/network` declared but
 * never read, so `<home>/EnvoyDev/secrets/mesh-identity.json` was never written and libp2p minted a
 * fresh Ed25519 identity on every process start. A pairing code's peer id then became an address the
 * phone could not dial — an outage that presents as a flaky network rather than a stale identity.
 *
 * Nothing caught it because the acceptance test starts a fresh peer against a fresh temp home every
 * run: an ephemeral id passes that. The assertions here are the ones that fail when the file is not
 * written, plus the negatives that stop a hardcoded key from passing the stability check too.
 */

import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { privateKeyToProtobuf } from "@libp2p/crypto/keys"
import { afterEach, describe, expect, it } from "vitest"

import { coderPaths, loadOrCreateMeshIdentity, meshIdentityPath } from "../src/index.js"

const homes: string[] = []

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-mesh-identity-"))
  homes.push(home)
  return home
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })))
})

const serialized = (key: Parameters<typeof privateKeyToProtobuf>[0]): number[] =>
  Array.from(privateKeyToProtobuf(key))

describe("a home's mesh identity", () => {
  it("is written on first load, creating the secrets directory", async () => {
    const home = await tempHome()
    const file = meshIdentityPath(coderPaths(home))
    // The directory does not exist either — the loader is responsible for both.
    await expect(stat(file)).rejects.toThrow()

    const key = await loadOrCreateMeshIdentity(file)

    expect(key.type).toBe("Ed25519")
    const info = await stat(file)
    expect(info.isFile()).toBe(true)
    // A real protobuf-serialized key, not an empty placeholder.
    expect((await readFile(file)).byteLength).toBeGreaterThan(0)
  })

  it("loads the same key on the second call", async () => {
    const file = meshIdentityPath(coderPaths(await tempHome()))
    const first = await loadOrCreateMeshIdentity(file)
    const second = await loadOrCreateMeshIdentity(file)
    expect(serialized(second)).toEqual(serialized(first))
  })

  it("is a different key for a different home", async () => {
    const first = await loadOrCreateMeshIdentity(meshIdentityPath(coderPaths(await tempHome())))
    const second = await loadOrCreateMeshIdentity(meshIdentityPath(coderPaths(await tempHome())))
    expect(serialized(second)).not.toEqual(serialized(first))
  })

  it("is a different key when the file is removed between loads", async () => {
    const file = meshIdentityPath(coderPaths(await tempHome()))
    const first = await loadOrCreateMeshIdentity(file)
    await rm(file)
    const second = await loadOrCreateMeshIdentity(file)
    expect(serialized(second)).not.toEqual(serialized(first))
  })

  it("fails loudly on an unreadable file rather than replacing the identity", async () => {
    const file = meshIdentityPath(coderPaths(await tempHome()))
    await loadOrCreateMeshIdentity(file)
    // A directory where the key should be: `readFile` fails `EISDIR`, not `ENOENT`, so the loader
    // must propagate rather than treat the key as missing and mint a replacement identity for the
    // user. Silently rotating a paired identity is the same outage, one restart later.
    await rm(file)
    await mkdir(file)
    await expect(loadOrCreateMeshIdentity(file)).rejects.toThrow()
  })
})
