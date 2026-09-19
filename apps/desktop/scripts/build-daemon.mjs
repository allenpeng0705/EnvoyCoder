/**
 * Bundle the daemon into one file the Tauri shell can spawn.
 *
 * ## Why a bundle at all
 *
 * The daemon is TypeScript, and the shell is a Rust binary that has to start it. Something has to
 * turn one into the other, and the options are: ship a TypeScript runner and the source (fragile,
 * slow to boot, and a runtime dependency the packaged app would have to carry), interpret it in
 * Rust (a second implementation of the protocol, which is the thing this repo exists to avoid), or
 * **bundle it once, at build time** (this). The shell then spawns `node dist-daemon/main.mjs` and
 * knows nothing about TypeScript.
 *
 * ## Why development leaves the dependencies external
 *
 * `packages: "external"` keeps `@envoymesh/*` and `@envoydev/*` as imports, resolved by Node from
 * the checkout at run time. That is the development arrangement: those packages are siblings on
 * disk, and a day-to-day rebuild should pick up a pulled sibling rather than a frozen copy.
 *
 * The installer sets `ENVOYDEV_DAEMON_PACKAGE=1`. A shipped app has no checkout, so that build
 * embeds our own packages. Third-party packages stay as imports and are copied into
 * `dist-daemon/node_modules`, because several of them are native addons (a `.node` file) and
 * cannot be folded into the script. `scripts/stage-desktop-bundle.mjs` refuses a bundle that
 * still imports a workspace package.
 *
 * Usage: `npm run daemon:build` (from the repository root, or `-w @envoydev/desktop`).
 */

import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const outDir = join(appDir, "dist-daemon");
const entry = join(appDir, "src", "daemon", "main.ts");

// A stale bundle is worse than no bundle: the shell would spawn code that no longer matches the
// source, and the symptom is a daemon that starts and behaves like last week's daemon.
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const packaged = process.env.ENVOYDEV_DAEMON_PACKAGE === "1";

const result = await build({
  entryPoints: [entry],
  outfile: join(outDir, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  // Matches the app's own build target, and Node 22 is the floor in the root manifest.
  target: "node22",
  sourcemap: !packaged,
  // Development keeps workspace packages as imports so a pulled sibling is what runs. A packaged
  // app has no checkout. Our own packages are embedded; npm packages are left as imports and
  // copied beside the bundle (`materializeNodeModules`), native addons included.
  ...(packaged ? { plugins: [externalNpmPlugin()] } : { packages: "external" }),
  banner: {
    // `require` is not defined in an ES module, and a dependency deep in the mesh still uses it.
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
  logLevel: "warning",
  metafile: true,
});

if (result.warnings.length > 0) {
  for (const warning of result.warnings) console.warn("daemon bundle:", warning.text);
}

const written = await stat(join(outDir, "main.mjs"));
console.log(
  `daemon bundle: dist-daemon/main.mjs (${(written.size / 1024).toFixed(1)} kB) — the shell spawns this with node`,
);

/** Leave `@envoydev/*` and `@envoymesh/*` to be bundled. Every other bare import is an npm package. */
function externalNpmPlugin() {
  return {
    name: "external-npm",
    setup(build) {
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        if (args.path.startsWith("node:")) return undefined;
        if (args.path.startsWith("@envoydev/") || args.path.startsWith("@envoymesh/")) return undefined;
        return { path: args.path, external: true };
      });
    },
  };
}

const repoRoot = resolve(appDir, "../..");
const resolvers = [repoRoot, resolve(repoRoot, "../EnvoyMesh"), appDir]
  .filter((dir) => existsSync(join(dir, "package.json")))
  .map((dir) => createRequire(join(dir, "package.json")));

function externalPackages(metafile) {
  const names = new Set();
  for (const output of Object.values(metafile.outputs ?? {})) {
    for (const imported of output.imports ?? []) {
      if (!imported.external) continue;
      const spec = imported.path;
      if (!spec || spec.startsWith("node:") || spec.startsWith(".") || spec.startsWith("/")) continue;
      names.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
    }
  }
  return [...names];
}

function locatePackage(name, prefer) {
  const tries = prefer ? [prefer, ...resolvers] : resolvers;
  for (const req of tries) {
    const onDisk = packageDirOnDisk(name, req);
    if (onDisk) {
      const pkg = JSON.parse(readFileSync(join(onDisk, "package.json"), "utf8"));
      return { dir: onDisk, pkg };
    }
  }
  return null;
}

function packageDirOnDisk(name, req) {
  const paths = req.resolve.paths(name) ?? [];
  for (const dir of paths) {
    const pkgFile = join(dir, ...name.split("/"), "package.json");
    if (existsSync(pkgFile)) return dirname(pkgFile);
  }
  return null;
}

function materializeNodeModules(metafile, out) {
  const names = externalPackages(metafile);
  const dest = join(out, "node_modules");
  mkdirSync(dest, { recursive: true });
  const seen = new Set();
  const missing = [];
  for (const name of names) copyPackage(name, dest, seen, missing, true, null);
  if (missing.length > 0) {
    const unique = [...new Set(missing)];
    console.error("The packaged daemon imports packages that are not installed:");
    for (const name of unique) console.error(`  ${name}`);
    process.exit(1);
  }
  console.log(`daemon node_modules: ${seen.size} packages beside the bundle`);
}

function copyPackage(name, dest, seen, missing, required, prefer) {
  if (seen.has(name)) return;
  const found = locatePackage(name, prefer);
  if (!found) {
    if (required) missing.push(name);
    return;
  }
  if (!found.dir.includes(`${sep}node_modules${sep}`)) {
    if (required) missing.push(name);
    return;
  }
  seen.add(name);
  const target = join(dest, ...name.split("/"));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(found.dir, target, {
    recursive: true,
    dereference: true,
    filter: (src) => !relative(found.dir, src).split(sep).includes("node_modules"),
  });
  const next = createRequire(join(found.dir, "package.json"));
  const dependencies = found.pkg.dependencies ?? {};
  const optional = { ...found.pkg.optionalDependencies, ...found.pkg.peerDependencies };
  for (const dep of Object.keys(dependencies)) {
    if (isWorkspaceSpec(dependencies[dep])) continue;
    copyPackage(dep, dest, seen, missing, true, next);
  }
  for (const dep of Object.keys(optional)) {
    if (seen.has(dep) || isWorkspaceSpec(optional[dep])) continue;
    copyPackage(dep, dest, seen, missing, false, next);
  }
}

function isWorkspaceSpec(spec) {
  return typeof spec === "string" && (spec.startsWith("workspace:") || spec.startsWith("file:"));
}

if (packaged) materializeNodeModules(result.metafile, outDir);
