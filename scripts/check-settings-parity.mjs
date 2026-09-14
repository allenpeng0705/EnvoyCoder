/**
 * Settings parity: every setting Paseo's settings surface has must have a verdict here.
 *
 * ## Why this gate exists
 *
 * `docs/settings-parity.md` is an inventory of Paseo's settings surface with a verdict for each entry.
 * An inventory of a *moving* source rots silently: Paseo adds a section, or a field on an existing
 * settings schema, and our verdict table keeps reading as complete because nothing tells it that the
 * question changed. The doc cannot check itself, so this script reads Paseo's source and fails when
 * something in it has no verdict in the doc.
 *
 * ## What it measures, precisely
 *
 * Four mechanically-extracted lists, unioned into the **coverage set**. Each item must appear in
 * `docs/settings-parity.md` as `` `item` `` on a line that also carries one of the four verdict
 * phrases — name-dropping is not a verdict table.
 *
 * | | Source | How it is read |
 * |---|---|---|
 * | **F1 sections** | `packages/app/src/screens/settings-screen.tsx` | `id: "…"` inside the `SIDEBAR_SECTION_ITEMS` and `HOST_SECTION_ITEMS` array literals — the UI's own registration, which is the only list that cannot disagree with the rendered sidebar |
 * | **F2 app settings** | `packages/app/src/hooks/use-settings/storage.ts` | the field names of `AppSettings` and `Settings`, plus one level of nesting for an object-valued field whose type is an interface in the same file, plus the keys of `SIDEBAR_ROW_ITEMS` (a record's keys live in a `const` array in the module that owns it) |
 * | **F3 host settings** | `packages/protocol/src/messages.ts` | the top-level fields of `MutableDaemonConfigSchema` — the daemon-side settings schema a host section patches |
 * | **F4 written keys** | the settings-surface files below | the keys at `settings.<k>` / `config.<k>` / `updateSettings({ … })` / `patchConfig({ … })` / `saveAppSettings` call sites |
 *
 * F4 is what catches a setting that is neither on the app settings object nor a top-level daemon
 * config field: `relay.enabled` is written by `desktop/components/pair-device-section.tsx`, and
 * `agentProfiles` by `agent-profiles/internal/use-agent-profiles.ts`. Neither is discoverable from
 * F2 or F3, and both are part of the surface.
 *
 * ## Its limits, which it prints rather than hides
 *
 * A gate that pretends to full coverage is worse than one that names its blind spots, because the
 * blind spot is then trusted. Three, and they are all stated in the output and in the doc's own
 * "what this check cannot see" section:
 *
 *   1. **A computed key is invisible to F4.** `settings[field]`, a spread of a form object, or a
 *      value built by a helper (`buildAcpProviderConfigPatch(entry)`) yields no readable key. Each
 *      such call site is reported with its `file:line` and a count, so a human can read the few that
 *      remain instead of trusting that there are none.
 *   2. **F2 and F3 are declared-shape lists, not effect lists.** They find a *different* thing from
 *      F4: a field that exists on a schema but that no section renders. That is deliberate — such a
 *      field is exactly the "stored and never shown" case the doc is required to name — but it means
 *      the coverage set is a superset of what a user can click.
 *   3. **A verdict is not verified.** The check proves a phrase is present, never that it is true.
 *      Telling "honour-able now" from a flattering lie is review, not grep.
 *
 * ## Not typechecked, and that is measured rather than assumed
 *
 * This is a `.mjs` file, and `tsconfig.unchecked.json` — the project whose whole purpose is "the code
 * `tsc -b` otherwise never sees" — includes `scripts/**\/*.ts` with no `allowJs`, so a `.mjs` gate is
 * **not** in its program. Verified: `npx tsc -p tsconfig.unchecked.json --listFiles --noEmit` lists
 * `scripts/smoke.ts` and `scripts/i18n-gap.ts` and does not list this file. That is the same deal the
 * four existing `.mjs` gates get (`check-wiring`, `check-family-docs`, `check-src-clean`,
 * `check-envoydeps`), so this file is consistent with them — but "the script is typechecked there" is
 * not true of any of them, and a doc that claimed it would be the same kind of lie this check exists
 * to catch. What keeps it honest instead is that it is a plain script with no dependencies beyond
 * `node:fs`/`node:path`/`node:url`, and its behaviour is its printed output.
 *
 * ## When the Paseo checkout is absent
 *
 * The sibling checkout is a *peer*, not a dependency (family guide §7.5), so its absence must not
 * red-line this repo's build — the same rule `check-family-docs.mjs` applies to a moved document.
 * Absence is reported loudly and exits 0; `--strict` (for a release) makes it a failure.
 *
 * Usage:
 *   node scripts/check-settings-parity.mjs
 *   node scripts/check-settings-parity.mjs --strict   # a missing Paseo checkout is a failure
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const strict = process.argv.includes("--strict");

/** The reference product's checkout. `PASEO_DIR` overrides it, so the gate is runnable elsewhere. */
const paseoRoot = process.env.PASEO_DIR
  ? path.resolve(process.env.PASEO_DIR)
  : path.resolve(root, "..", "paseo");

const DOC = "docs/settings-parity.md";

/** The four verdicts, verbatim as they must read in the doc. Adding one here is the only way to add one. */
const VERDICTS = [
  "honour-able now",
  "honour-able with work",
  "not applicable",
  "must be disabled-with-reason",
];

/**
 * The settings surface, by file.
 *
 * `dir` is walked for `.ts`/`.tsx`; `files` are read directly. Both are listed explicitly rather than
 * guessed, so what F4 covers is a fact about this list and not about a directory name that happened
 * to match. `desktop/` is here because two desktop-only sections write daemon or desktop state, and
 * `agent-profiles/` and `agent-skills/` because host sections render them without their code living
 * under `screens/settings/` — the `agents` section is not one file, and pretending it is would leave
 * the whole subsystem unchecked.
 */
const SURFACE = {
  dirs: [
    "packages/app/src/screens/settings",
    "packages/app/src/desktop/components",
    "packages/app/src/desktop/browser/settings",
    "packages/app/src/agent-profiles",
    "packages/app/src/agent-skills",
  ],
  files: [
    "packages/app/src/screens/settings-screen.tsx",
    "packages/app/src/desktop/settings/desktop-settings.ts",
    "packages/app/src/components/sidebar/display-preferences/row-items.ts",
    "packages/app/src/components/sidebar/display-preferences/checks-display.ts",
  ],
};

const SECTION_FILE = "packages/app/src/screens/settings-screen.tsx";
const APP_SETTINGS_FILE = "packages/app/src/hooks/use-settings/storage.ts";
const DESKTOP_SETTINGS_FILE = "packages/app/src/desktop/settings/desktop-settings.ts";
const DAEMON_CONFIG_FILE = "packages/protocol/src/messages.ts";

/**
 * Absence first, before anything is read.
 *
 * The sibling checkout is a *peer*, not a dependency (family guide §7.5), so its absence must not
 * red-line this repo's build — the same rule `check-family-docs.mjs` applies to a moved document.
 * But a silent pass would be worse than a failure: a gate that reports "OK" without having read
 * anything teaches people to trust a green light that means nothing, so the note says exactly that.
 */
if (!existsSync(paseoRoot)) {
  console.log(
    `note: the Paseo checkout was not found at ${paseoRoot}, so nothing was measured and this run\n` +
      "    proves nothing about the setting inventory. Point PASEO_DIR at a checkout to check it.",
  );
  if (strict) {
    console.error(
      "\n--strict: a setting inventory cannot be verified without the source it inventories.\n",
    );
    process.exit(1);
  }
  process.exit(0);
}

/* ────────────────────────────── source reading ────────────────────────────── */

const failures = [];
const notes = [];
const measured = { sections: 0, appSettings: 0, hostSettings: 0, written: 0, callSites: 0, unresolved: 0 };

function read(rel) {
  return readFileSync(path.join(paseoRoot, rel), "utf8");
}

/**
 * The body of the first `{ … }` group at or after `from`, by brace depth.
 *
 * Counting braces is enough for the shapes this script reads — an interface body, a `z.object` body —
 * and it is deliberately not a parser: this check's job is to notice that Paseo's settings surface
 * grew, not to understand all of it.
 */
function bracedBody(text, from) {
  const open = text.indexOf("{", from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** The same, for a group that may be opened by `{`, `[` or `(` and may mix the three. */
function balancedBody(text, from) {
  const openers = "{[(";
  const closers = "}])";
  let start = -1;
  for (let i = from; i < text.length; i += 1) {
    if (openers.includes(text[i])) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const stack = [];
  for (let i = start; i < text.length; i += 1) {
    const opened = openers.indexOf(text[i]);
    if (opened !== -1) {
      stack.push(opened);
      continue;
    }
    const closed = closers.indexOf(text[i]);
    if (closed === -1) continue;
    if (stack.pop() !== closed) return null; // unbalanced: refuse rather than guess
    if (stack.length === 0) return text.slice(start + 1, i);
  }
  return null;
}

/** Strip comments, so a commented-out field is not read as a setting. */
function uncommented(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** String literals blanked out, so an i18n key is never read as a settings path. */
function stripStrings(text) {
  return text
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/** The body of a named `export interface`, or of the `z.object({…})` a named schema const builds. */
function declarationBody(kind, name, text) {
  const declaration =
    kind === "interface"
      ? new RegExp(`export interface ${name}\\b[^{]*\\{`).exec(text)
      : new RegExp(`export const ${name} = z\\b`).exec(text);
  if (!declaration) return null;
  const from = declaration.index + declaration[0].length - (kind === "interface" ? 1 : 0);
  return kind === "interface" ? bracedBody(text, from) : bracedBody(text, from);
}

/**
 * The field names declared at the top level of a body, in source order.
 *
 * A field whose annotation opens a group (`cfg: { … }`, `list: z.array(…)`) is skipped whole, so a
 * nested key is never reported as a field of the object containing it.
 */
function topLevelFields(body) {
  const source = uncommented(body);
  const fields = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if ("{[(".includes(char)) {
      const inner = balancedBody(source, i);
      i = inner === null ? source.length : i + inner.length + 2;
      continue;
    }
    const match = /^([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(source.slice(i));
    if (match) {
      fields.push(match[1]);
      i += match[0].length;
      continue;
    }
    i += 1;
  }
  return fields;
}

/**
 * The settings a named declaration carries, with one level of nesting.
 *
 * One level, because that is where a nested name becomes a setting in its own right: `notifications`
 * is not something a user sets, `notifications.playSound` is, and the doc must give the second one a
 * verdict. Two shapes are descended into — an object type declared in the same file
 * (`openInSidePane: OpenInSidePanePreferences`) and an inline one (`notifications: { playSound: … }`)
 * — because Paseo uses both, and reading only the first would half-cover the desktop settings.
 */
function nestedFields(name, text, kind = "interface") {
  const body = declarationBody(kind, name, text);
  if (body === null) return [];
  const source = uncommented(body);

  const found = [];
  const push = (key) => {
    if (!found.includes(key)) found.push(key);
  };

  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if ("{[(".includes(char)) {
      const inner = balancedBody(source, i);
      i = inner === null ? source.length : i + inner.length + 2;
      continue;
    }
    const match = /^([A-Za-z_$][\w$]*)\s*\??\s*:\s*/.exec(source.slice(i));
    if (!match) {
      i += 1;
      continue;
    }
    const field = match[1];
    push(field);
    const after = i + match[0].length;
    if (source[after] === "{") {
      const inner = bracedBody(source, after);
      if (inner !== null) {
        for (const key of topLevelFields(inner)) push(`${field}.${key}`);
        i = after + inner.length + 2;
        continue;
      }
    }
    const named = /^([A-Za-z_$][\w$]*)/.exec(source.slice(after));
    if (named && new RegExp(`export interface ${named[1]}\\b`).test(text)) {
      const innerBody = declarationBody("interface", named[1], text);
      if (innerBody !== null) {
        for (const key of topLevelFields(innerBody)) push(`${field}.${key}`);
      }
    }
    i = after;
  }
  return found;
}

/** Top-level fields of a `z.object({ … })` assigned to a named const. */
function schemaFields(name, text) {
  const body = declarationBody("schema", name, text);
  if (body === null) return [];
  return topLevelFields(body);
}

/** The string elements of a `const NAME = [ … ] as const;` literal. */
function stringArray(name, text) {
  const declaration = new RegExp(`export const ${name} = \\[`).exec(text);
  if (!declaration) return [];
  const open = text.indexOf("[", declaration.index);
  const close = text.indexOf("]", open);
  if (close === -1) return [];
  return [...text.slice(open, close).matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/** Every `.ts`/`.tsx` under a surface directory, relative to the Paseo root. */
function walk(rel) {
  const absolute = path.join(paseoRoot, rel);
  const found = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (["node_modules", "dist", "build"].includes(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        found.push(path.relative(paseoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  if (existsSync(absolute)) visit(absolute);
  return found;
}

/* ────────────────────────────── F1: sections ────────────────────────────── */

const settingsScreen = read(SECTION_FILE);
const sections = [];
for (const listName of ["SIDEBAR_SECTION_ITEMS", "HOST_SECTION_ITEMS"]) {
  const start = settingsScreen.indexOf(`const ${listName}`);
  const end = settingsScreen.indexOf("];", start);
  if (start === -1 || end === -1) {
    failures.push(
      `could not find the \`${listName}\` array in ${SECTION_FILE}. The section list moved or was ` +
        "renamed, so this check cannot tell which sections exist any more.",
    );
    continue;
  }
  for (const match of settingsScreen.slice(start, end).matchAll(/\bid:\s*"([a-z0-9-]+)"/g)) {
    sections.push({ id: match[1], tier: listName === "SIDEBAR_SECTION_ITEMS" ? "app" : "host" });
  }
}
measured.sections = sections.length;

/* ────────────────────────── F2: app-scope settings ────────────────────────── */

const storage = read(APP_SETTINGS_FILE);
const desktopSettings = read(DESKTOP_SETTINGS_FILE);
const appKeys = new Map(); // dotted key → "the declaration it came from — its file"

/** `AppSettings` + `Settings` (app-scope) and `DesktopSettings` (desktop-scope), each one level deep. */
for (const [file, rel, name] of [
  [storage, APP_SETTINGS_FILE, "AppSettings"],
  [storage, APP_SETTINGS_FILE, "Settings"],
  [desktopSettings, DESKTOP_SETTINGS_FILE, "DesktopSettings"],
]) {
  for (const key of nestedFields(name, file)) {
    if (!appKeys.has(key)) appKeys.set(key, `app setting in \`${name}\` — ${rel}`);
  }
}
// `SidebarRowItems` is `Record<SidebarRowItem, boolean>`: the keys are a const array, not a body, and
// the array is the only place that says what a row item is — so it is read rather than guessed.
for (const item of stringArray(
  "SIDEBAR_ROW_ITEMS",
  read("packages/app/src/components/sidebar/display-preferences/row-items.ts"),
)) {
  appKeys.set(
    `sidebarRowItems.${item}`,
    "app setting in `SIDEBAR_ROW_ITEMS` — packages/app/src/components/sidebar/display-preferences/row-items.ts",
  );
}
measured.appSettings = appKeys.size;

/* ────────────────────────── F3: host-scope settings ────────────────────────── */

const protocol = read(DAEMON_CONFIG_FILE);
// Both schemas: the full config is what a host setting *is*, and the patch schema is what a settings
// section can actually change — `removeProviders` exists only in the second, and a doc that covers
// the first and not the second would miss the fact that removing a provider is a user-facing action.
const hostKeys = [
  ...new Set([
    ...schemaFields("MutableDaemonConfigSchema", protocol),
    ...schemaFields("MutableDaemonConfigPatchSchema", protocol),
  ]),
];
measured.hostSettings = hostKeys.length;

/* ───────────────────────── F4: keys written from the surface ───────────────────────── */

const surfaceFiles = [
  ...SURFACE.files,
  ...SURFACE.dirs.flatMap((dir) => walk(dir)),
].filter((rel, index, all) => all.indexOf(rel) === index && existsSync(path.join(paseoRoot, rel)));

const writtenKeys = new Map(); // key → "file:line"
let callSites = 0;
let unresolved = 0;
const unresolvedSites = [];

/**
 * The keys of the object literal that starts at `open`, at its own depth only.
 *
 * Depth-1-only is the difference between a useful set and noise. `patchConfig({ providers: { [id]: {
 * enabled } } })` must yield `providers`; yielding `enabled` too would force a verdict for a field of a
 * *value*, and an inventory padded with non-settings stops being read.
 *
 * Two shapes count as a key, and the second one is why the first version of this function found
 * **nothing at all**: `{ theme: value }` is a property, and `{ theme }` is a shorthand property.
 * Paseo writes `updateSettings({ theme })` far more often than the long form, so a reader that only
 * understood `identifier:` reported every call site as unreadable — a check that prints 37 warnings
 * it can never clear is a check nobody reads.
 */
function objectKeys(source, open) {
  const keys = [];
  let depth = 0;
  let identifier = "";
  // After a `:` everything up to the next `,` is a *value*. Without this flag the value's own
  // identifier is read as a second key, and `{ sendBehavior: behavior }` would demand a verdict for
  // `behavior`.
  let inValue = false;

  /** After an identifier at depth 1: `:` makes it a property, `,` or `}` makes it shorthand. */
  const settle = (next) => {
    if (identifier === "" || inValue) {
      if (next === ":") inValue = true;
      identifier = "";
      return;
    }
    if (next === ":" || next === "," || next === "}" || next === "") keys.push(identifier);
    if (next === ":") inValue = true;
    identifier = "";
  };

  for (let i = open; i < source.length; i += 1) {
    const char = source[i];

    if (char === "{" || char === "[" || char === "(") {
      if (depth === 1) settle(char); // a value's own group: settles an identifier either way
      depth += 1;
      identifier = "";
      continue;
    }
    if (char === "}" || char === "]" || char === ")") {
      depth -= 1;
      if (depth === 0) {
        settle(char);
        return keys;
      }
      identifier = "";
      continue;
    }
    if (depth !== 1) continue; // inside a value or after the literal: not our business

    if (inValue) {
      if (char === ",") inValue = false;
      continue;
    }

    if (/[A-Za-z_$]/.test(char)) {
      identifier += char;
      continue;
    }
    // Whitespace and identifier continuations do **not** settle: `{ a, b }` ends `a` at the comma and
    // `b` at the brace, and settling on the space before the brace would drop the last key — which is
    // how every one-key shorthand patch (`updateSettings({ theme })`) went missing.
    if (/[\w$\s]/.test(char)) continue;
    settle(char);
  }
  return keys;
}

/** 1-based line number of a character offset, for a message a human can open. */
function lineAt(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

for (const rel of surfaceFiles) {
  const source = read(rel);
  const lines = source.split("\n");

  // **A write.** The argument object of `updateSettings` / `patchConfig` / `saveAppSettings`. Read
  // over the whole file rather than line by line, because the object usually opens on the call's own
  // line (`patchConfig({ providers: … })`) and a line-based reader cannot see inside it.
  for (const call of source.matchAll(/\b(?:updateSettings|patchConfig|saveAppSettings)\s*\(/g)) {
    callSites += 1;
    const after = call.index + call[0].length;
    const open = source.indexOf("{", after);
    const at = `${rel}:${lineAt(source, call.index)}`;
    // No `{` before the argument list closes: the patch is a helper's return value or a variable.
    if (open === -1 || /[A-Za-z_$][\w$.]*\s*\(/.test(source.slice(after, open))) {
      unresolved += 1;
      unresolvedSites.push(`${at}  ${lines[lineAt(source, call.index) - 1].trim()}`);
      continue;
    }
    const keys = objectKeys(source, open);
    if (keys.length === 0) {
      unresolved += 1;
      unresolvedSites.push(`${at}  ${lines[lineAt(source, call.index) - 1].trim()}`);
      continue;
    }
    for (const key of keys) if (!writtenKeys.has(key)) writtenKeys.set(key, at);
  }

  // **A read.** `settings.x` / `config.x` / `desktopSettings.settings.x`. Strings are blanked first,
  // because Paseo's i18n keys are also spelled `settings.something.something` — reading those as
  // settings would fill the coverage set with copy and make the doc unusable.
  lines.forEach((line, index) => {
    const at = `${rel}:${index + 1}`;
    for (const match of stripStrings(line).matchAll(
      /(?<![\w$.])(?:settings|config|appSettings|desktopSettings)\.([A-Za-z_$][\w$]*)/g,
    )) {
      if (!writtenKeys.has(match[1])) writtenKeys.set(match[1], at);
    }
  });
}
measured.written = writtenKeys.size;
measured.callSites = callSites;
measured.unresolved = unresolved;

/* ────────────────────────────── coverage set ────────────────────────────── */

/**
 * The coverage set: what the doc must account for, each with a one-line "where it comes from" so the
 * failure message can say more than "something is missing".
 *
 * **First origin wins, and the order is the priority.** `notifications` is both a registered section
 * and a field of `DesktopSettings`; `providers` is both a section and a daemon config field. Reporting
 * the section is the more useful answer, because that is where a reader meets it — so sections are
 * inserted first and a later source may not overwrite them.
 */
const coverage = new Map();
const cover = (item, origin) => {
  if (!coverage.has(item)) coverage.set(item, origin);
};
for (const { id, tier } of sections) cover(id, `section (\`${tier}\`-scope) — ${SECTION_FILE}`);
for (const [key, origin] of appKeys) cover(key, origin);
for (const key of hostKeys) {
  cover(key, `daemon setting in \`MutableDaemonConfigSchema\` — ${DAEMON_CONFIG_FILE}`);
}
for (const [key, at] of writtenKeys) {
  cover(key, `read or written from the settings surface — ${at}`);
}

/**
 * `--list` prints the coverage set and stops.
 *
 * The check's definition of "a setting" has to be inspectable, because "the doc is complete" is only
 * meaningful against a stated list. Without this, a reader who suspects the doc is padded or the check
 * is shallow has to read this file to find out.
 */
if (process.argv.includes("--list")) {
  for (const [item, origin] of coverage) console.log(`${item}\n    ${origin}`);
  console.log(
    `\n${coverage.size} item(s) in the coverage set: ${measured.sections} section(s), ` +
      `${measured.appSettings} app setting(s), ${measured.hostSettings} daemon setting(s), ` +
      `${measured.written} key(s) touched by the settings surface.`,
  );
  process.exit(0);
}

/* ────────────────────────────── the doc ────────────────────────────── */

const docPath = path.join(root, DOC);
if (!existsSync(docPath)) {
  console.error(`\n${DOC} does not exist, so no Paseo setting has a verdict.\n`);
  console.error(
    `  The check would look for ${coverage.size} item(s): ${measured.sections} section(s), ` +
      `${measured.appSettings} app setting(s), ${measured.hostSettings} daemon setting(s), ` +
      `${measured.written} key(s) touched by the settings surface.\n`,
  );
  process.exit(1);
}

const docLines = readFileSync(docPath, "utf8").split("\n");
const missing = [];
const unverdicted = [];

for (const [item, origin] of coverage) {
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp("`" + escaped + "`");
  const hits = docLines.filter((line) => pattern.test(line));
  if (hits.length === 0) {
    missing.push({ item, origin });
    continue;
  }
  if (!hits.some((line) => VERDICTS.some((verdict) => line.includes(verdict)))) {
    unverdicted.push({ item, origin });
  }
}

/* ────────────────────────────── report ────────────────────────────── */

const problems = [];
if (missing.length > 0) {
  problems.push(
    `${missing.length} Paseo setting(s) have no line in ${DOC}:\n` +
      missing
        .map(
          (entry) =>
            `      \`${entry.item}\`\n        from: ${entry.origin}\n` +
            `        fix:  add a row for \`${entry.item}\` — what it comes from, what it does, and one\n` +
            "              of: " + VERDICTS.join(" / "),
        )
        .join("\n"),
  );
}
if (unverdicted.length > 0) {
  problems.push(
    `${unverdicted.length} Paseo setting(s) are named in ${DOC} without a verdict:\n` +
      unverdicted
        .map(
          (entry) =>
            `      \`${entry.item}\`\n        from: ${entry.origin}\n` +
            `        fix:  the line naming it must also carry one of: ${VERDICTS.join(" / ")}. A name\n` +
            "              in a list is not a decision about whether we can honour it.",
        )
        .join("\n"),
  );
}

if (problems.length > 0) {
  console.error(`\n${DOC} is out of date with Paseo's settings surface:\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error(
    "This is what the gate is for: Paseo grows, and an inventory that is not re-read becomes a claim\n" +
      "we cannot back. The doc also has to say what this check cannot see — see its\n" +
      '"what this check cannot see" section.\n',
  );
  process.exit(1);
}

console.log(
  `settings parity OK — ${coverage.size} item(s) accounted for in ${DOC}: ` +
    `${measured.sections} section(s) (${[...new Set(sections.map((s) => s.tier))].sort().join(" + ")}), ` +
    `${measured.appSettings} app setting(s), ${measured.hostSettings} daemon setting(s), ` +
    `${measured.written} key(s) touched by the settings surface; each named with a verdict`,
);

// The blind spots, printed rather than hidden: a check whose limits are unstated invites people to
// read "green" as "complete".
console.log(
  `limits: ${measured.callSites} setting-writing call site(s) read; ${measured.unresolved} named no ` +
    "statically readable key (a helper or a spread builds the patch), so those are unchecked by F4 " +
    "— each is listed below for a human to read.",
);
for (const site of unresolvedSites) console.log(`  unchecked call site: ${site}`);
console.log(
  "limits: F2/F3 read declared schema shapes, not effects — a field defined but never rendered is " +
    "in the set on purpose (it is the \"stored and never shown\" case), so the set is a superset of " +
    "what a user can click.",
);
console.log(
  "limits: a verdict is proven PRESENT, never proven true. The phrase only has to appear on the line " +
    "naming the item, so a row that denies a verdict in prose (\"not honour-able now because…\") " +
    "satisfies this check exactly as well as a row that gives one — the fix is to write the verdict " +
    "as the bare phrase in its own cell, and the reason a reader should re-derive is that this " +
    "distinction is review, not grep.",
);
for (const note of notes) console.log(`note: ${note}`);
