/**
 * EnvoyDev's **own** libp2p identity: where it lives, and how it is loaded or created.
 *
 * ## Why the loader lives in the product layer
 *
 * `EnvoyMeshOptions.libp2pPrivateKey` is the *honoured* way to hand libp2p a stable identity — the
 * network package reads that option at `../EnvoyMesh/packages/network/src/index.ts:839` and passes
 * it to `createLibp2p` at `:855`. The network package reads no file, by design: the family loader
 * lives in the app "so the network package has no filesystem dependency — the Diplomat boundary
 * stays clean" (`../EnvoyMesh/apps/node/src/libp2p-key-loader.ts:17-18`).
 *
 * That reason still holds here, and it is why this file is in `host-bridge` rather than in the
 * family. The key is EnvoyDev's **product state** under `<home>/EnvoyDev/secrets/`, and the product
 * layer is where touching a filesystem is legitimate. The rejected alternatives were to give
 * `@envoymesh/network` an fs dependency (the boundary above), to add fs + `@libp2p/crypto` to
 * `@envoymesh/node-core` (a broad family core package), or to mint a new family package for one
 * 34-line function — all larger changes to a shared layer than this bug warrants. The two
 * duplicated family loaders (`apps/node`, `apps/relay`) remain; consolidating them is a separate
 * family change, not something this product fix should smuggle in.
 *
 * ## The format
 *
 * Protobuf-serialized Ed25519, the same bytes the family's own loaders write, so the file in a
 * user's `secrets/` directory stays a key the rest of the family can read.
 *
 * ## The dependency pin
 *
 * `package.json` declares `@libp2p/crypto` and `@libp2p/interface` at the **exact** versions the
 * linked `@envoymesh/network` resolves (`5.1.18`, `3.2.2`), not the caret ranges the family declares.
 * This module returns the `PrivateKey` type that `EnvoyMeshOptions` declares, and that type flows
 * from whichever `@libp2p/interface` is installed here: caret ranges pulled `3.3.0` plus
 * `uint8arraylist@3.0.2`, whose `Uint8ArrayList` is a different generic shape, and `npx tsc -b`
 * rejected the assignment. Matching the family's versions is what keeps it one type rather than two
 * structurally-similar ones; an upgrade on either side now fails the typecheck instead of drifting.
 */

import { generateKeyPair, privateKeyFromProtobuf, privateKeyToProtobuf } from "@libp2p/crypto/keys"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type { EnvoyMeshOptions } from "@envoymesh/network"

// Type-only, so there is no runtime cycle: `index.ts` re-exports this module, and this import is
// erased. Same trick `mesh-peer.ts` uses for `CoderPaths`.
import type { CoderPaths } from "./index.js"

/**
 * The key type `EnvoyMeshOptions` accepts, spelled through the option itself.
 *
 * Derived rather than imported from `@libp2p/interface` so the type is *exactly* the one the
 * network package's declaration expects: if libp2p's `PrivateKey` ever drifts from what
 * `EnvoyMeshOptions` declares, this alias fails to compile instead of a cast hiding it.
 */
export type CoderMeshPrivateKey = NonNullable<EnvoyMeshOptions["libp2pPrivateKey"]>

/**
 * Where this product's libp2p seed lives: `<home>/EnvoyDev/secrets/mesh-identity.json`.
 *
 * Distinct from the family profile's key (`<home>/profile/libp2p-private.key` — see
 * `../EnvoyMesh/apps/node/src/index.ts:1232`) on purpose. Sharing that key would mean two processes
 * holding one identity the moment the user starts EnvoyMesh — corruption, not sharing — and a phone
 * paired with the node's peer id would be pairing with a different app.
 */
export function meshIdentityPath(paths: CoderPaths): string {
  return join(paths.secretsDir, "mesh-identity.json")
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

/**
 * Load the persisted Ed25519 key from `keyFilePath`, or generate one and write it `0o600`.
 *
 * Read errors that are *not* "the file is not there" propagate: a key we cannot read (permissions,
 * a truncated file) must fail the peer's `start()` loudly rather than be papered over with a fresh
 * identity — silently replacing a user's identity is exactly the outage this module exists to end.
 */
export async function loadOrCreateMeshIdentity(keyFilePath: string): Promise<CoderMeshPrivateKey> {
  try {
    const bytes = await readFile(keyFilePath)
    return privateKeyFromProtobuf(new Uint8Array(bytes))
  } catch (error) {
    if (!isMissingFileError(error)) throw error
  }

  const key = await generateKeyPair("Ed25519")
  // `recursive` because `secretsDir` may not exist on a first run; the mode matters because this is
  // a private key, and 0o600 is what the family's own loaders write.
  await mkdir(dirname(keyFilePath), { recursive: true })
  await writeFile(keyFilePath, privateKeyToProtobuf(key), { mode: 0o600 })
  return key
}
