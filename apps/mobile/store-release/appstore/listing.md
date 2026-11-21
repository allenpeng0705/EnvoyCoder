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
| Support URL | `https://github.com/allenpeng0705/EnvoyCoder/issues` |
| Marketing URL | `https://www.envoymesh.cn` |
| Privacy Policy URL | `https://www.envoymesh.cn/privacy.html` |

Suggested privacy policy topics (covered on the family privacy page under **EnvoyDev**):

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
| Audio Data | Yes (optional composer dictation; may use Apple speech recognition, not an EnvoyDev backend) | No (not to EnvoyDev; Apple’s speech service may process audio while dictating) | No | App functionality |
| Location | No | — | — | — |

**Data Not Collected** vs **Collected**: declare what the phone sends to the user’s own daemon and (if enabled later) Apple push services — not a third-party EnvoyDev backend.

---

## Age rating

Suggested: **4+**. Confirm with Apple’s questionnaire. There is no unrestricted social UGC feed; content is the user’s own agent transcripts on machines they pair.

---

## Review notes (for App Review team)

For a **2.5.2 rejection**, paste the full letter in
[`resolution-2.5.2-reply.md`](resolution-2.5.2-reply.md). For a normal submission,
use the short notes below (and the longer block in `apple_google_reviewing.md`).

Paste-ready block (keep in sync with `REVIEW-NOTES-PASTE.txt`):

```
IMPORTANT — Guideline 2.5.2 (please read first)

EnvoyDev Mobile does NOT download, install, or execute agent/tool/code on the iPhone.
It is a thin companion UI only. Coding agents, shells, and tool calls run exclusively
on the paired EnvoyDev desktop daemon on the user’s own computer. The phone only shows
project/task transcripts and sends high-level RPCs (pair, open project/task, send a
message, Confirm/Reject). There is no on-device agent runtime, terminal/shell, OTA
update mechanism, or downloaded native agent code. Optional SSH in the app is only a
local port-forward to reach the desktop daemon — not an interactive shell on the phone.

No username/password / no central EnvoyDev account
Pairing uses a QR code (or paste of an envoy://pair link). There is nothing to sign up for.

About AI / third-party services (phone binary)
The iOS app does not embed a third-party AI SDK and does not send prompts or user
content to any third-party AI API. Any model or tool work happens on the user’s own
computer through the EnvoyDev desktop they already run and configure. The phone only
connects to that paired computer to view status and control settings / approvals.

Demo video (architecture walkthrough):
https://youtu.be/DFoRIRMSHCU

=== Demo desktop for App Review (kept online during review) ===

Step-by-step test (about 2–3 minutes):
1. Install EnvoyDev from this build.
2. Open the app → Add computer / Pair.
3. Tap Paste link (or Scan QR). Allow Camera only if scanning.
4. Paste the Pairing URI below and connect.
5. If iOS asks for Local Network, tap Allow (helps LAN; cellular/mesh still works if denied).
6. After pairing succeeds: open the sample project → open the sample task → scroll the
   transcript. Prefer a completed run.
7. If an Approval / Confirm–Reject card appears: tap Reject (safe review action). That
   only answers the desktop daemon; it does not run code on the phone.
8. Optional: browse Connection / Settings screens. You do not need to start a new agent
   run for this review.

Pairing URI (paste into Add computer):
envoy://pair?pairing=H4sIAAAAAAAAE7WTS5OaUBCF_8pUb4P3wUugKgtFHWUY4ogjQzJZcK9iQAN35E0q_z2F2SSprFKml119vjp9qvsb1GBRCZoCLGgKC2NqyojqBlKQoVnqeExwU4AEZX4CC57SF3oK4-b0cvFtEldzsjEfY7Jvd1pJ35oSJMiTPVhwyOq8s_ImO1ysc86j88igXNfYnjL9oHJN0wbmdZTKM-Uhz4NFMa23nR0nTp0EVHds5raL6Nh9PPFtsq7iUN4-Z1x3fX9SgwRMgPUJcCJUTOUxIoggiksusK4QImMhC_yP5J_MX2K4IVYdI1NBlCKZylesSgj9jep6GzUIg-W0aA5G1Wp9UHQ6r-67JgvXDtuzaMKY-Oo8piwfhCOeXHiVlLewJmsUmRSZ479bmwTJzheFnYo0qnpDSVK3OraNzzdOYpieup7Q3RO1-yLj7NbWbpja_1kYPksQCQEWzIfbnx0G97kYvmY01HR-v_Lu1s9Td2XfPczDa_M1y1Zp5vY9DzzNv1DXL3fH9AszF60ffSiW5_74brbtsLPEZPX-NbuK5t7sTw58_wGxrReYyQMAAA

Permissions you may see (all optional except Camera for QR):
• Camera — scan the desktop pairing QR
• Local Network — reach the desktop on Wi‑Fi
• Microphone / Speech — optional dictation into a message (skip if unused)
• Photos — optional image attach (skip if unused)

Contact (demo desktop / questions during review):
shilei.peng@qq.com
Alternate: shileipeng@gmail.com

This pairing URI is for App Review only. End users mint their own QR from their own
EnvoyDev desktop (Settings → Mobile Pairing).
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
- Camera, photo library, microphone, and speech-recognition usage strings are in `ios/Runner/Info.plist`
- Export compliance: uses encryption (HTTPS / TLS / mesh) — usually **exempt** standard encryption; answer the questionnaire accordingly
