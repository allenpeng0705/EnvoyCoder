# EnvoyDev Mobile — Google Play listing

Paste these fields into [Google Play Console](https://play.google.com/console). Character limits are noted.

Replace every `TODO:` before submit.

---

## Store listing

| Field | Value |
|-------|--------|
| App name (30) | EnvoyDev |
| Package name | `com.envoymesh.envoydev` |
| Default language | English (United States) — or your locale |
| Application type | App |
| Category | Productivity |
| Tags (optional) | Tools, Developer tools |
| Free / paid | Free |

### App name alternatives (≤30)

- EnvoyDev
- EnvoyDev Mobile

---

## Short description (80)

```
Watch coding agents on your machines. Pair by QR — no central account.
```

Alternatives (≤80):

```
EnvoyDev companion: pair to your desktop, approve agents, steer runs.
```

```
Remote window for EnvoyDev — transcripts, approvals, queue & steer.
```

---

## Full description (4000)

```
EnvoyDev is the Android companion for the EnvoyDev desktop app — a control plane for coding agents that run on computers you own.

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

## What’s new (release notes)

```
Initial public release of EnvoyDev Mobile.

• Pair to EnvoyDev desktop with a QR code, host:port, or SSH hop
• Browse projects and tasks on your machines
• Read live transcripts and answer approvals
• Queue follow-ups and steer running agents
• Secure pairing tokens stored in Android Keystore-backed storage
```

---

## Contact details

| Field | Value |
|-------|--------|
| Email | `shilei.peng@qq.com` (alternate: `shileipeng@gmail.com`) |
| Phone | optional |
| Website | `https://www.homeclaw.cn/envoy` |
| Privacy policy | `https://www.homeclaw.cn/envoy/privacy` |

---

## Graphics

| Asset | Spec | Path |
|-------|------|------|
| App icon | 512×512 PNG, **32-bit, opaque** | `icons/app-icon-512.png` |
| Feature graphic | 1024×500 PNG/JPEG | `icons/feature-graphic-1024x500.png` |

Convenience copies also live in `../play-store-assets/` (same files).

### Icon / graphic checklist

- [ ] App icon uploaded (512×512, no transparency)
- [ ] Feature graphic uploaded (1024×500)
- [ ] Phone screenshots (min 2; max 8) — see below
- [ ] Optional: 7" / 10" tablet screenshots
- [ ] Optional: promo video

---

## Screenshots checklist

Minimum **2** phone screenshots. Recommended **5**:

1. Connections — paired machines
2. Projects on a host
3. Open task — live transcript
4. Approval card (if available)
5. Pairing / QR screen

Use a recent phone resolution (e.g. 1080×1920 or device native). Avoid status-bar secrets.

Overlay caption ideas:

1. Your agents, from your phone
2. Pair once with a QR code
3. Watch the live transcript
4. Approve before risky steps
5. Code stays on your machine

Brand colors: charcoal `#1b1b1d`, cyan `#00ccca`, white text.

---

## Data safety form — draft answers

Play Console → App content → Data safety. Align with your real setup.

| Data type | Collected? | Shared? | Purpose | Optional? | Encrypted in transit? |
|-----------|------------|---------|---------|-----------|------------------------|
| User IDs (pairing / session) | Yes | With your EnvoyDev desktop / daemon | App functionality | No | Yes |
| Device or other IDs (FCM, if push is added) | Only if you enable push | With your desktop (for push) | Notifications | Yes | Yes |
| Messages / prompts / transcripts | Yes (via your desktop) | Via your desktop daemon | App functionality | No | Yes |
| Photos (attachments / QR) | Yes | Via desktop when sending | App functionality | Yes | Yes |
| Approx location | No | — | — | — | — |
| Crash logs | Only if you enable Play / Firebase Crashlytics | — | — | — | — |

**Data deletion**: users can unpair / uninstall; desktop project and task retention is controlled by the desktop owner — state that clearly in the privacy policy.

**Security practices**:

- [x] Data encrypted in transit (TLS / secure WebSocket / mesh crypto)
- [ ] Users can request deletion — `TODO` document how (unpair on phone + remove paired device on desktop)
- [ ] Committed to Play Families Policy — N/A (not a kids app)

---

## App access / restricted features

If reviewers cannot pair without a desktop:

```
EnvoyDev Mobile requires an EnvoyDev desktop app (daemon) on a computer.

Demo credentials / QR for Google review:

Full guide: apple_google_reviewing.md (sibling of this file).

1. Open EnvoyDev Mobile → Add computer → Scan QR or paste URI.
2. Pairing URI:
   TODO: paste the live envoy://pair?… URI for this submission
3. After pair: open a project → open a task → read the transcript.
4. Demo desktop is online during review. Contact: TODO: you@example.com
```

Play Console → App content → App access.

---

## Permissions justification (for review / declarations)

| Permission | Why |
|------------|-----|
| INTERNET | Connect to EnvoyDev desktop / mesh / relay |
| CAMERA | Pairing QR scan |
| READ media / photos | Optional image attach on a message |
| POST_NOTIFICATIONS | Alerts when you enable them (Android 13+) |

Camera usage string suggestion:

> EnvoyDev uses the camera to scan the pairing code shown on your computer.

---

## Content rating

Complete the IARC questionnaire in Play Console. Expected result roughly **Everyone** / **PEGI 3**, depending on answers about user-generated content (here: the user’s own agent transcripts on paired machines).

---

## Target audience & news

- Target age: 18+ or 13+ as appropriate (developer tool; not a kids app)
- Not a news app

---

## Ads

Does this app contain ads? **No**

---

## Build & submit reminders

### Sign for Google Play (upload key)

Play uses **Play App Signing**: you sign the AAB with an **upload key**; Google re-signs with the **app signing key** for devices.

1. **Create a keystore once** (store passwords in a password manager):

```bash
cd apps/mobile/android
keytool -genkey -v -keystore upload-keystore.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

2. **Configure Gradle** (keep secrets out of git):

```bash
# Create android/key.properties with storePassword, keyPassword, keyAlias=upload, storeFile=…
```

3. **Build the Play bundle**:

```bash
cd apps/mobile
# Bump pubspec version first: 0.1.0+N  (N = versionCode, must increase every upload)
flutter build appbundle --release
# → build/app/outputs/bundle/release/app-release.aab
```

4. **Play Console**
   - Create the app (`com.envoymesh.envoydev`) if needed
   - First upload: enable **Play App Signing** → upload `app-release.aab`
   - Keep `upload-keystore.jks` offline

Do **not** commit `key.properties`, `*.jks`, or `*.keystore`.

Current IDs:

- `applicationId` / namespace (Android) and bundle ID (iOS): `com.envoymesh.envoydev`
- versionName / versionCode: from Flutter `pubspec.yaml` (`0.1.0+N` → name `0.1.0`, code `N`)
