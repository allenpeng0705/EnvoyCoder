# Resolution Center reply — 2.5.2 round 2 (Nov 18, 2026)

Use this after the second identical Guideline 2.5.2 rejection.
Primary ask: **App Review Appointment** + the exact on-device action they saw.

Submission ID from Apple: `7a90e432-cd11-40fa-87e3-b75aabd89fb3`  
Review date: November 18, 2026 · Device: iPad Air 11-inch (M3) · Version: 1.0 (20)

---

## Paste into App Store Connect → Resolution Center

```text
Hello App Review Team,

Thank you for the update on Submission ID 7a90e432-cd11-40fa-87e3-b75aabd89fb3
(reviewed November 18, 2026 on iPad Air 11-inch (M3), version 1.0 (20)).

We received the same Guideline 2.5.2 finding again:

  “During review, the app installed or launched executable code.”

  (with the educational-app / viewable-source next-steps language)

We have already explained in writing that EnvoyDev Mobile does not download,
install, or execute code on the iOS / iPadOS device. Because the written
clarification was not sufficient to resolve the finding, we are requesting
direct help.

REQUEST 1 — App Review Appointment
Please schedule an App Review Appointment (Meet with Apple) so we can
demonstrate the architecture live and resolve Guideline 2.5.2. We are available
during our local business hours on Tuesdays and Thursdays (China Standard Time,
UTC+8). Preferred contacts: shilei.peng@qq.com / shileipeng@gmail.com.

REQUEST 2 — Exact trigger
Please tell us the exact screen, button, or step during review that was
interpreted as installing or launching executable code on the iPad. Without
that detail we can only repeat the architecture explanation, which has not
cleared the finding.

BRIEF ARCHITECTURE (for the appointment)
• EnvoyDev Mobile is a thin companion UI. The reviewed binary does not download
  app code, dylibs, OTA/CodePush bundles, or plugins, and does not run a local
  shell/interpreter on iPadOS.
• Coding agents and any shell/tool calls run only on a paired EnvoyDev desktop
  on the user’s computer. The iPad shows a remote transcript and sends RPCs
  (pair, open task, send message, Confirm/Reject).
• Confirm/Reject does not execute code on the iPad; it only answers the desktop.
• Optional SSH is a local port-forward to reach the desktop daemon, not an
  on-device terminal.

DEMO FOR RE-REVIEW / APPOINTMENT
There is no username/password.

1. Open EnvoyDev Mobile → Add computer → paste the pairing URI below (or scan QR
   if attached).
2. Pairing URI:
   TODO: paste the live envoy://pair?… URI
3. Please open the sample project → sample task → scroll a completed transcript.
   If an approval appears, tap Reject. That only sends an RPC to the demo
   desktop; it does not launch code on the iPad.
4. Demo desktop is online. Contact: shilei.peng@qq.com

We respect Guideline 2.5.2 and the self-contained app requirement. We are not
asking for an exception to run downloaded code on device — we are asking for
confirmation that remote desktop transcripts are not being treated as on-device
code execution, or for the specific on-device behavior you observed so we can
remove or change it.

Thank you for your time after this long review cycle. We are ready for an
appointment at your earliest Tuesday/Thursday availability.

Sincerely,
Shilei Peng
EnvoyDev / EnvoyMesh
https://www.envoymesh.cn
shilei.peng@qq.com
shileipeng@gmail.com
Bundle ID: com.envoymesh.envoydev
Submission ID: 7a90e432-cd11-40fa-87e3-b75aabd89fb3
```

---

## Also do this outside the reply

1. In App Store Connect / the rejection message, use **Request an App Review
   Appointment** / Meet with Apple (Tuesdays & Thursdays).
2. On the demo desktop before they look again: only a **finished** chat-like
   transcript — no pending “allow shell” approval, no live running agent if you
   can avoid it.
3. In review notes for the next binary: first line must be “No code runs on the
   iPad; agents run only on the paired desktop.”
4. If the appointment still fails on 2.5.2, consider a review build that
   disables Start run / Send / Confirm on iPad and only allows browsing a
   finished transcript — then re-enable after approval. Say so if you want that
   implemented in the app.
