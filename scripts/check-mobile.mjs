/**
 * The mobile app is a Flutter project, so it is not part of the npm workspaces — but it must not
 * rot invisibly either. This checks that the pieces a build needs are present, and says what to run
 * instead of failing with a Dart error nobody can read.
 *
 * Usage: `npm run mobile:check`
 */

import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..", "apps", "mobile");

const required = [
  "pubspec.yaml",
  "lib/main.dart",
  "lib/services/pairing_service.dart",
  "lib/services/host_client.dart",
];
const missing = required.filter((file) => !existsSync(path.join(mobile, file)));

if (missing.length > 0) {
  console.error(`The mobile app is missing files a build needs:\n  ${missing.join("\n  ")}`);
  console.error(`\n  expected under: ${mobile}`);
  process.exit(1);
}

const pubspec = readFileSync(path.join(mobile, "pubspec.yaml"), "utf8");
const name = /^name:\s*(\S+)/m.exec(pubspec)?.[1];
if (name !== "envoycoder_mobile") {
  console.error(`pubspec.yaml names the app "${name}", expected "envoycoder_mobile".`);
  process.exit(1);
}

// Flutter is a separate toolchain and this script will not pretend otherwise: it reports whether
// the tool is present rather than trying to run it.
const flutterHint =
  process.env.FLUTTER_ROOT || process.env.PATH?.includes("flutter")
    ? "Flutter appears to be available."
    : "Flutter was not found on PATH; install it to build the mobile app.";

console.log(
  `mobile app present (${name}); ${required.length} build-critical files found.\n  ${flutterHint}\n` +
    "  build:  cd apps/mobile && flutter pub get && flutter test",
);
