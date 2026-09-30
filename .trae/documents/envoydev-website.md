# EnvoyDev marketing site

## Context

EnvoyDev is the coding-agent control plane in the EnvoyMesh apps family. The EnvoyMesh homepage already links to `envoydev/` from a "Sister product" card; that link currently 404s because no site lives there yet. Goal: build a bilingual marketing + download site that visually matches the EnvoyMesh site (same dark theme, purple/cyan tokens, sticky header, download-card pattern, language switcher) and ships the desktop installers + Android APK the user already has hosted, plus QR-only placeholders for the App Store and Google Play listings (real URLs + real QRs come after release).

## Decisions (confirmed with user)

- **Build target**: `/Users/shileipeng/Documents/mygithub/EnvoyCoder/sites/envoydev/` — a working copy inside the EnvoyCoder repo. The user copies the folder across to `EnvoyMesh/sites/envoydev/` when ready to deploy. From the deployed location, `../` reaches EnvoyMesh's site root.
- **Bilingual**: `index.html` (English) + `index-zh.html` (Chinese), mirroring the EnvoyMesh pattern.
- **Store UI = QR codes only, no badge buttons**: show a QR code for App Store and a QR code for Google Play. No "Download on the App Store" / "Get it on Google Play" badge buttons.
- **QR codes are rendered client-side** with `qrcode.js` (same CDN library EnvoyMesh's `qr_review.html` uses: `https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js`). Each QR encodes a fake placeholder URL constant at the top of the `<script>`. When the user gets real listing URLs, they edit the two constants and the QRs regenerate on next page load — no PNG files to swap. The existing `app-store-qr.png` / `google-play-qr.png` placeholders in EnvoyMesh/sites/screens/ are NOT used.
- **Fake URL placeholders** (clearly placeholder, easy to find and replace):
  - `APP_STORE_URL = "https://apps.apple.com/app/envoydev/id000000000"` (placeholder ID)
  - `GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.envoymesh.envoydev"` (real bundle ID per README, fake listing URL)
- **Real download links** (from user, used as direct-download buttons):
  - macOS: `https://gpt4people.online/EnvoyMesh/envoydev-desktop.dmg`
  - Windows: `https://gpt4people.online/EnvoyMesh/envoydev-desktop.exe`
  - Android APK: `https://gpt4people.online/EnvoyMesh/envoydev_mobile.apk`
  - GitHub releases: `https://github.com/allenpeng0705/EnvoyCoder/releases`
- **EnvoyMesh cross-links**: `../index.html` (EN), `../index-zh.html` (ZH). These are deployment-time paths — they only resolve after the user copies the folder into `EnvoyMesh/sites/envoydev/`. That's expected and matches the user's "access EnvoyMesh via `../`" instruction. Locally they 404; visually the site is still fully previewable.
- **EnvoyDev accent**: purple `#818cf8` on `rgba(99, 102, 241, 0.15)` — matches the "Sister product" badge the EnvoyMesh homepage already uses for EnvoyDev, so the family look stays consistent.

## Folder layout (self-contained site)

```
EnvoyCoder/sites/envoydev/
├── index.html                         # English page (inline <style> + <script>)
├── index-zh.html                      # Chinese page (mirror)
├── README.md                          # short note: how to deploy + where to swap URLs
└── screens/                           # self-contained assets — travel with the site
    ├── envoydev-logo.png              # copied from EnvoyCoder/apps/desktop/assets/logo.png
    ├── envoymesh-logo.png             # copied from EnvoyMesh/sites/logo.png (for "Built on EnvoyMesh" section)
    ├── project.png                    # copied from EnvoyCoder/sites/screens/project.png
    ├── agents.png                     # copied from EnvoyCoder/sites/screens/agents.png
    ├── mobile-projects.jpg            # copied + renamed from mobile_projects.jpg
    ├── mobile-chats.jpg               # copied + renamed from mobile_chats.jpg
    └── mobile-connection.jpg          # copied & renamed from mobile_connection.jpg
```

Self-contained so the user can copy the whole `envoydev/` folder to `EnvoyMesh/sites/envoydev/` and everything (except the `../` cross-links to EnvoyMesh pages) just works. The existing `EnvoyMesh/sites/screens/envoydev-project.png` and `envoydev-agents.png` were pre-staged but become orphaned by this self-contained approach — the user can delete them or leave them; no harm either way.

## Page sections (both EN and ZH, mirrored content)

1. **Sticky header** — EnvoyDev logo (`screens/envoydev-logo.png`) + nav (Features, Agents, Mobile, Download) + `中文`/`EN` switch + GitHub icon + `Install` CTA. Mobile hamburger overlay. Pattern lifted from EnvoyMesh `index.html` L1923-L1987; the language switch links cross between `index.html` ↔ `index-zh.html` in the same folder.
2. **Hero** — Headline "The control plane for coding agents" + sub (run Claude Code, Codex, OpenCode, Cursor, and more on your own machines; reach them from a window or a phone; open source, self-hosted, local-first) + CTAs (`Download` → `#downloads`, `View on GitHub` → releases) + hero screenshot `screens/project.png` in a tilted/framed window + a small "Built on EnvoyMesh →" pill linking to `../index.html`.
3. **What is EnvoyDev** — Intro section paraphrasing README §"What is EnvoyDev?" (one unified window for every coding agent; code never leaves your machine; model keys stay with the agent; no account; built on EnvoyMesh).
4. **Features (Desktop)** — Grid of feature cards from README's desktop bullets: one window every agent; projects on the left, tasks in the middle; see what the agent is doing (live transcript); approve before risky steps; cancel/queue/steer; git where the work is; keep the daemon reachable; pair once, stay paired; reach another home from this laptop; team jobs; resume after a disconnect; macOS/Windows/Linux. Each card = icon + title + one-line description.
5. **Coding agents supported** — Two-column: left = tiered list (Built-in: Envoy Harness; Catalogued: DeepSeek Harness, Claude Code, Codex, GitHub Copilot, OpenCode, Cursor, OMP, Pi; ACP catalog: 38 more); right = `screens/agents.png`. Note: "Your model credentials live with the agent that uses them — EnvoyDev never proxies them, never asks for an account."
6. **EnvoyDev Mobile** — Section with the 3 mobile screenshots (`screens/mobile-projects.jpg`, `screens/mobile-chats.jpg`, `screens/mobile-connection.jpg`) in a phone-frame gallery + feature bullets from README §"Phone" + three "ways to pair" cards (📷 QR code / 🔌 `host:port` / 🔐 SSH hop). Copy: thin client by design; never runs an agent; never holds a provider key.
7. **Built on EnvoyMesh** — Card with the EnvoyMesh logo (`screens/envoymesh-logo.png`) + copy (shares identity, discovery, mesh/pairing UX; state is per-product under `<home>/EnvoyDev/`) + CTA "Learn about EnvoyMesh →" linking to `../index.html` (and `../index-zh.html` from the Chinese page).
8. **Download / Get the apps** — Reuse EnvoyMesh `download-card` pattern (L1267-L1391). Three cards:
   - **Desktop** card: macOS `.dmg` button (real link, "Apple Silicon / Intel" tag) + Windows `.exe` button (real link) + a "GitHub releases" alt link for Linux tarball + source.
   - **Android** card: primary = Google Play QR (JS-rendered from `GOOGLE_PLAY_URL`, with "Pending review" caption); alt = direct APK download button (real link).
   - **iOS** card: App Store QR (JS-rendered from `APP_STORE_URL`, with "Pending review" caption). No badge button — QR only, per user instruction.
   - Note row: "App Store and Google Play listings are pending review. The QR codes will resolve to the live stores once the listings are approved. The Android APK above works today."
9. **Footer** — columns: Product (Features, Mobile, Download), Family (EnvoyMesh, GitHub), Resources (README on GitHub, Collaboration docs), and a bottom row with copyright + "Built on EnvoyMesh" line. Pattern lifted from EnvoyMesh footer.

## Style approach (single inline `<style>` block, copied from EnvoyMesh)

Copy verbatim from `EnvoyMesh/sites/index.html`:
- `:root` token block (L16-L31): `--primary-color: #6366f1`, `--primary-dark: #4f46e5`, `--primary-light: #818cf8`, `--secondary-color: #06b6d4`, `--accent-color: #f59e0b`, `--bg-dark: #0f172a`, `--bg-card: #1e293b`, `--bg-card-hover: #334155`, `--text-primary: #f8fafc`, `--text-secondary: #94a3b8`, `--text-muted: #64748b`, `--border-color: #334155`, `--gradient-primary`, `--gradient-secondary`.
- Base reset + body (L33-L48), `.container` (L50-L54).
- Sticky `header` + `nav` + `.logo` + `.nav-links` + `.nav-dropdown` + `.nav-actions` + `.mobile-menu-btn` (L56-L200), mobile-nav-overlay.
- `.btn` / `.btn-primary` / `.btn-secondary` / `.btn-nav-cta`.
- `.hero` / `.hero-content` / `.hero-logo` / `.hero-stats`, `.section-header`, feature-card grid.
- `.downloads` / `.download-grid` / `.download-card` / `.download-icon.{mac,windows,android,ios}` / `.download-link.{primary,alt}` / `.download-note` (L1267-L1391).
- `.footer` + responsive breakpoints.

Layer EnvoyDev-specific tweaks on top: a `.envoydev-card` style matching the existing "Sister product" badge (`rgba(99, 102, 241, 0.15)` bg + `#818cf8` text). Self-contained scroll-reveal via `IntersectionObserver` (or just CSS hover transitions) for cards.

## QR code rendering (qrcode.js, inline `<script>`)

Same library + pattern as `EnvoyMesh/sites/qr_review.html` L268-L302:

```js
// === Store listing URLs — replace with real ones after release ===
const APP_STORE_URL  = "https://apps.apple.com/app/envoydev/id000000000";        // placeholder
const GOOGLE_PLAY_URL = "https://play.google.com/store/apps/details?id=com.envoymesh.envoydev"; // placeholder
// === End store URLs ===

QRCode.toCanvas(
  document.createElement("canvas"),
  APP_STORE_URL,
  { errorCorrectionLevel: "M", margin: 1, width: 200,
    color: { dark: "#0f172a", light: "#ffffff" } },
  function (err, canvas) { if (!err) document.getElementById("qr-app-store").appendChild(canvas); }
);
// same for GOOGLE_PLAY_URL → #qr-google-play
```

White QR on the dark card via an inner white padded box (so the QR scans reliably). Each QR sits in a `.qr-box` with a caption underneath ("App Store — pending review" / "Google Play — pending review").

## Verification

- Open `EnvoyCoder/sites/envoydev/index.html` and `index-zh.html` directly in a browser (file://). Check: sections render, all 5 screenshots + 2 logos load, language switch cross-links work, all internal anchors work, the two QR codes render and scan to the fake URLs.
- Click every real download link: macOS dmg, Windows exe, Android APK, GitHub releases — should resolve or start a download.
- Hover the App Store / Play QR captions: confirm "pending review" copy is clear.
- Resize to mobile breakpoint: hamburger appears, nav overlay opens, download grid collapses to one column, mobile screenshots stack, QR codes remain scannable.
- After the user copies `envoydev/` to `EnvoyMesh/sites/envoydev/`: click `../index.html` and `../index-zh.html` cross-links — they should land on the EnvoyMesh homepage. The "Built on EnvoyMesh" logo (`screens/envoymesh-logo.png`) is self-contained and works in both locations.
- No build step, no framework, no external CSS — just two static HTML files + a screens/ folder.

## Out of scope

- No real App Store / Google Play URLs (user edits two JS constants after release; QRs auto-regenerate).
- No store badge buttons (user wants QR codes only for the stores).
- No Linux direct-download link (Linux users go through GitHub releases).
- No TestFlight / Play Console review QR page (EnvoyMesh has `qr_review.html` for EnvoyGo; not requested for EnvoyDev).
- No build system, package.json, or framework.
- Does not touch the existing `EnvoyMesh/sites/screens/envoydev-*.png` files — they become orphaned but harmless; the user can clean them up or leave them.
