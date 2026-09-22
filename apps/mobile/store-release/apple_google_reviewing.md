# Apple / Google store review — EnvoyDev Mobile demo desktop

How reviewers try **EnvoyDev Mobile**, and how to run a **dedicated EnvoyDev desktop** with a pairing QR/URI they can use for the whole review window — without putting review secrets into normal user installs.

EnvoyDev Mobile has **no username/password**. Pairing uses a QR / URI minted by the EnvoyDev desktop (Settings → Mobile Pairing, or the rail “pair phone” control).

```text
envoy://pair?pairing=<compressed-payload>
```

There is **no special “review build” of the phone app**. Reviewers install the same binary; you keep a demo desktop online and give them a valid pairing URI.

---

## Recommended review flow

### What you do (operator)

1. Install **EnvoyDev desktop** on a **dedicated** machine or profile (throwaway projects are fine).
2. Start the desktop so the daemon is hosting and mesh/LAN reachability works from cellular if needed.
3. Open **Settings → Mobile Pairing** (or mint from the palette / rail) and show a **QR code**.
4. **Copy the full pairing URI** (and optionally save a QR PNG).
5. Paste that URI into App Store Connect / Play Console review notes.
6. Keep the demo desktop **online** for the whole review window, reachable over LAN + relay / public WS so a phone on cellular can dial.

Default pairing records on EnvoyDev desktop use a long TTL (about **one year** unless you pass a shorter `ttlMs`). That is already long enough for store review — you do not need EnvoyGo’s `ENVOY_REVIEW_PAIRING` machinery.

### What the reviewer does

1. Install EnvoyDev Mobile from TestFlight / Play internal testing / store build.
2. Open the app → **Add computer** → scan the QR **or paste** the `envoy://pair?…` URI.
3. After pair: open a **project** → open a **task** → read the transcript.
4. If an approval card is pending: **Confirm** or **Reject**.
5. Optionally send a short follow-up (Queue / Steer) if a run is active.

### Demo content tips

Reviewers move faster when the demo desktop already has:

- At least one **project** folder
- At least one **task** with a short transcript (even a finished run)
- Optionally a pending **approval** so they can exercise Confirm/Reject

Avoid putting real secrets, customer code, or production API keys on the review machine.

---

## What to put in store review notes

```text
EnvoyDev Mobile has no login/password. Pairing is QR-only (or paste the URI).

Demo desktop for App Review / Play review:

1. Open EnvoyDev Mobile → Add computer → Scan QR (or paste the URI below).
2. Pairing URI:
   envoy://pair?pairing=<PASTE_FULL_URI>
3. After pair: open the sample project → open the sample task → scroll the transcript.
   If an approval is shown, tap Confirm or Reject.
4. Demo desktop is online 24/7 during review. Contact: you@example.com

Notes for reviewers:
- The phone is a thin client. Agents run on the demo desktop, not on the phone.
- First connect can take a short time while the app walks LAN / mesh / relay candidates.
- This URI is for store review only. Normal users mint their own QR from their own EnvoyDev desktop.
```

Also attach a **QR PNG** if the console allows attachments.

---

## Safety: will this affect normal users?

**No**, as long as you:

1. Use a **dedicated** demo desktop / profile for review.
2. Do **not** ship review-only env vars or secrets in end-user desktop builds.
3. Rotate / discard the review pairing (remove the paired-device record, or wipe the demo profile) after review if you no longer want that URI to work.

The phone app does not contain a backdoor. It only accepts pairing tokens the desktop issues.

---

## Reachability checklist

Reviewers are rarely on your LAN. Before you submit:

- [ ] Demo EnvoyDev desktop is running (daemon hosting)
- [ ] Pairing QR minted; full `envoy://pair?…` URI copied
- [ ] Phone on cellular can complete pairing (mesh / public / relay path works)
- [ ] Sample project + task present for the reviewer to open
- [ ] Contact email in the notes is monitored
- [ ] After review: stop the demo or remove the paired-device record / wipe the profile

---

## Differences from EnvoyGo review

| | EnvoyGo | EnvoyDev Mobile |
|--|---------|-----------------|
| Home to pair with | EnvoyMesh home node (Social) | **EnvoyDev desktop** daemon |
| Family invite / owner QR | Yes (`envoy://invite` vs `envoy://pair`) | Owner-style **product** pairing only (`envoy://pair` for EnvoyDev) |
| Special review env | `ENVOY_REVIEW_PAIRING*` / `APPLE_REVIEW=1` | Not required — desktop TTL is already long |
| What reviewers test | Chat, EnvoyAI, voice | Projects, tasks, transcript, approvals, queue/steer |

Do **not** send EnvoyGo family-invite URIs to EnvoyDev Mobile reviewers — the family’s app check will refuse the wrong product’s code.

---

## Related paths

| Path | Role |
|------|------|
| `apps/mobile/` | Flutter phone app |
| `apps/desktop/` | EnvoyDev window + daemon that mints pairing |
| `apps/desktop/src/components/settings/PairingSection.tsx` | Mobile Pairing settings UI |
| `apps/desktop/src/daemon/paired-devices.ts` | Issued pairing records + TTL |
| `apps/mobile/store-release/appstore/listing.md` | App Store listing + short review notes |
| `apps/mobile/store-release/googleplay/listing.md` | Play listing + app access notes |
