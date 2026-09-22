# EnvoyDev Mobile — Apple App Store listing

Paste these fields into [App Store Connect](https://appstoreconnect.apple.com). Character limits are noted.

Replace every `TODO:` before submit.

---

## App information

| Field | Value |
|-------|--------|
| Name (30) | EnvoyDev |
| Subtitle (30) | Coding agents on your machines |
| Bundle ID | `com.envoymesh.envoydev` |
| SKU (suggested) | `envoydev-ios` |
| Primary category | Developer Tools |
| Secondary category | Productivity |
| Content rights | Does not contain third-party content |
| Price | Free |

### Subtitle alternatives (≤30)

- Agents on your own machines
- Pair. Watch. Approve. Steer.
- Remote window for EnvoyDev

---

## Promotional text (170) — editable anytime

```
Pair EnvoyDev on your phone to the desktop on your machine. Watch coding agents, answer approvals, queue follow-ups, and steer runs — your code and keys stay on the computer.
```

---

## Description (4000)

```
EnvoyDev is the mobile companion for the EnvoyDev desktop app — a control plane for coding agents that run on computers you own.

Pair once, then check on Claude Code, Codex, OpenCode, Cursor, DeepSeek Harness, Envoy Harness, and other agents from your phone. The desktop runs the work; the phone is a thin window into the same projects and tasks.

PAIR IN SECONDS
• Scan the pairing QR shown in EnvoyDev on your computer
• Or paste a host address and short token when you are on the same network
• Or reach a machine over SSH when you are away from home
• No central EnvoyDev account — identity and sessions stay with your machine

SEE WHAT THE AGENT IS DOING
• Browse projects and tasks on each paired computer
• Read the live transcript: messages, tool calls, and file changes
• Answer approval prompts before risky steps
• Queue a follow-up or steer the run without leaving the phone

THIN CLIENT BY DESIGN
• The phone never runs an agent and never holds a model API key
• Your code stays in the project folders on the desktop
• Reconnect over LAN, mesh, or SSH — the work keeps running if the phone drops

REQUIREMENTS
• EnvoyDev desktop running on a Mac, Windows, or Linux machine
• A pairing QR or invite from that desktop (Settings → Mobile Pairing)

EnvoyDev Mobile is part of the EnvoyMesh apps group: it shares mesh pairing and reachability with the family, and keeps EnvoyDev project and task state separate on your machine.
```

---

## Keywords (100 chars max, comma-separated, no spaces after commas preferred)

```
coding,agent,dev,CLI,Claude,Codex,Cursor,pair,QR,remote,approve,transcript,self-hosted,envoy
```

Count check: keep under 100 characters total (Apple counts commas).

Shorter backup if over limit:

```
coding,agent,dev,CLI,pair,QR,remote,approve,Claude,Codex,envoy
```

---

## What’s New (0.1.0)

```
Initial public release of EnvoyDev Mobile.

• Pair to EnvoyDev desktop with a QR code, host:port, or SSH hop
• Browse projects and tasks on your machines
• Read live transcripts and answer approvals
• Queue follow-ups and steer running agents
• Secure pairing tokens stored in the device Keychain
```

---

## Support & marketing URLs

| Field | Value |
|-------|--------|
| Support URL | `TODO: https://…` (required) |
| Marketing URL | `TODO: https://…` (optional) |
| Privacy Policy URL | `TODO: https://…` (required) |

Suggested privacy policy topics to cover:

- Pairing / session tokens stored on device (Keychain / secure storage)
- Camera for QR pairing
- Photo library only when attaching an image to a message
- Optional SSH credentials the user pastes for a hop (stored securely; never sent to an EnvoyDev cloud)
- Transcript and project data are read from the user’s own EnvoyDev desktop / daemon — not an EnvoyDev cloud inbox
- No central EnvoyDev account

---

## App Privacy (nutrition labels) — draft answers

Use App Store Connect → App Privacy. Adjust if your push / analytics setup differs.

| Data type | Collected? | Linked to identity? | Used for tracking? | Purpose |
|-----------|------------|---------------------|--------------------|---------|
| Contact Info | No | — | — | — |
| Identifiers (Device / User ID) | Yes (pairing / session tokens on device) | Yes (your machine’s pairing record) | No | App functionality |
| Usage Data | No (unless you add analytics) | — | — | — |
| Diagnostics | Optional (crash only if you enable) | — | — | — |
| Other User Content (prompts / transcripts) | Processed via your desktop daemon | Yes | No | App functionality |
| Photos / Camera | Yes (QR scan; optional image attach) | No | No | App functionality |
| Location | No | — | — | — |

**Data Not Collected** vs **Collected**: declare what the phone sends to the user’s own daemon and (if enabled later) Apple push services — not a third-party EnvoyDev backend.

---

## Age rating

Suggested: **4+**. Confirm with Apple’s questionnaire. There is no unrestricted social UGC feed; content is the user’s own agent transcripts on machines they pair.

---

## Review notes (for App Review team)

```
EnvoyDev Mobile requires an EnvoyDev desktop app (daemon) on a computer. Without pairing it shows the connections / pair UI only.

Demo path for reviewers:
See apple_google_reviewing.md in this folder (demo desktop + long-lived pairing QR).

1. Open EnvoyDev Mobile → Add computer → Scan QR (or paste the pairing URI).
2. Pairing URI:
   TODO: paste the live envoy://pair?… URI for this submission
3. After pair: open a project → open a task → read the transcript. If an approval is pending, Confirm or Reject it.
4. Demo desktop is online during review. Contact: TODO: you@example.com

Permissions:
• Camera — scan the desktop pairing QR
• Photo Library — optional image attach on a message

No account creation on a central server. The credential is a pairing token for the user’s own machine.
```

---

## Icons

| File | Spec | Path |
|------|------|------|
| App Store icon | 1024×1024 PNG, **RGB, no alpha** | `icons/app-icon-1024.png` |
| Full-bleed approx | Same, corners filled for Connect mask warnings | `icons/app-icon-1024-fullbleed-approx.png` |

### Icon checklist

- [ ] Upload **1024×1024** with **no transparency**
- [ ] Prefer artwork that fills the square; Apple applies the mask
- [ ] No competing logos / “beta” banners

Source mark: `apps/mobile/assets/logo.png` (cyan prompt + bolt on charcoal).

---

## Screenshots checklist

Apple requires device-sized screenshots (at least one size class).

### iPhone (required) — capture on a recent device / simulator

Suggested set (6.7" or 6.9" primary):

1. **Connections** — paired machines list
2. **Projects** — projects on a connected host
3. **Task / run** — live transcript with messages and tool calls
4. **Approval** — permission card (Confirm / Reject) if available
5. **Pairing** — QR scan or paste-link screen

Optional: iPad if you enable iPad.

### Caption ideas (for your design overlays — not App Store text fields)

1. “Your agents, from your phone”
2. “Pair once with a QR code”
3. “Watch the live transcript”
4. “Approve before risky steps”
5. “Code stays on your machine”

Brand colors: charcoal `#1b1b1d`, cyan `#00ccca`, white text.

---

## Build & submit reminders

```bash
cd apps/mobile
# Bump pubspec version first: 0.1.0+N
flutter build ipa   # after signing / certificates configured in Xcode
```

- Version: `CFBundleShortVersionString` from Flutter `version` name (`0.1.0`)
- Build: `CFBundleVersion` from Flutter build number (`N`)
- Camera usage string is already in `Info.plist`
- Export compliance: uses encryption (HTTPS / TLS / mesh) — usually **exempt** standard encryption; answer the questionnaire accordingly
