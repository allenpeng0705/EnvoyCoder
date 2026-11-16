# Escalation email — App Review delay (1.5+ months)

**Where to send**

1. Prefer **App Store Connect → Resolution Center** on the same submission thread
   (highest chance the App Review team reads it).
2. Also open a case at [Apple Developer Support](https://developer.apple.com/contact/)
   → App Review / App Store Connect, and attach or paste this text.
3. Optional To line if you email Support: use the contact form; do not rely on a
   public `@apple.com` address alone.

Replace every `TODO:` before sending. Keep the tone firm and factual — ask for
escalation and a timed re-review, not a refund rant.

This version quotes Apple’s Guideline **2.5.2** rejection text and answers it
point by point (same finding as in `resolution-2.5.2-reply.md`).

---

## Subject

```text
Escalation request: EnvoyDev (com.envoymesh.envoydev) — 1.5+ month review & Guideline 2.5.2
```

## Body

```text
Dear App Review / Apple Developer Support,

I am writing to escalate a prolonged App Review for our iOS app and to request
urgent reconsideration of the Guideline 2.5.2 rejection.

App name: EnvoyDev
Bundle ID: com.envoymesh.envoydev
Apple ID / Team: TODO: your Team Name / Team ID
App Store Connect app: TODO: link or Apple ID of the app if available
Submission / version: TODO: version and build number (e.g. 1.1.0 (17))
Developer: Shilei Peng
Contact: shilei.peng@qq.com (alternate: shileipeng@gmail.com)

══════════════════════════════════════
1. REVIEW DELAY
══════════════════════════════════════

We have been in App Review for this product for more than one and a half months
(approximately TODO: start date → today). That is far beyond Apple’s published
typical review times. The delay has blocked our release, delayed users waiting
for the iOS companion, and created material cost for a small team.

Throughout this period we have responded in good faith, kept a dedicated demo
desktop online for reviewers, and provided pairing credentials and review notes
so the app can be exercised without a login or password.

We respectfully ask for escalation and a prioritized re-review with a defined
timeline after this long wait.

══════════════════════════════════════
2. APPLE’S FINDING (quoted)
══════════════════════════════════════

App Review wrote, in substance:

  Issue Description
  During review, the app installed or launched executable code.

  While educational apps designed to teach, develop, or allow students to test
  executable code may, in limited circumstances, download code, such code may
  not be used for other purposes and such apps must make the source code
  completely viewable and editable by the user.

  Next Steps
  - Revise the app to address the issues identified above.
  - Once the app is fully compliant, resubmit the app for review.

  Resources
  Learn more about self-contained app requirements in guideline 2.5.2.

  Extended Review: This app was found to include one or more issues that present
  significant safety, security, or quality concerns to users. Repeated
  submissions of apps with these issues will result in extended review times.
  Accounts that repeatedly submit apps that do not follow the App Review
  Guidelines and the Apple Developer Program License Agreement face removal
  from the Apple Developer Program.

We take Guideline 2.5.2 and the Extended Review warning seriously. We believe
this finding is based on a misunderstanding of where work runs, not on the iOS
app downloading or launching executable code on the device.

══════════════════════════════════════
3. POINT-BY-POINT RESPONSE TO GUIDELINE 2.5.2
══════════════════════════════════════

A) “During review, the app installed or launched executable code.”

EnvoyDev Mobile does not install or launch executable code on the iPhone.

• The shipped binary is a single Flutter/iOS app. There is no mechanism to
  download additional app code, dylibs, frameworks, feature packs, OTA/CodePush
  bundles, or plugins after install.
• The phone does not embed a user-facing shell, terminal, or code interpreter
  that runs on iOS.
• Any “shell”, “tool”, or “agent” activity visible in the UI is a remote
  transcript of work that runs only on a paired EnvoyDev desktop daemon on the
  user’s own computer. The phone displays that transcript and sends high-level
  RPCs (pair, open project/task, send a message, Confirm/Reject an approval).
• Tapping Confirm or Reject on an approval does not execute code on iOS; it only
  sends an approval decision to the already-running desktop agent.
• Optional SSH support is only a local port-forward so the app can reach the
  user’s desktop daemon when it is not on the same LAN. It is not an interactive
  remote shell on the iPhone and does not install or launch code on device.

So the educational-app exception in the rejection text (download code for
teaching, with source viewable/editable by the student) does not apply to our
architecture: we are not downloading code into the iOS app at all. We are a thin
companion to software that already runs on the user’s computer.

B) “Revise the app… Once fully compliant, resubmit”

We are not aware of an on-device code path that would require removing a
feature to become 2.5.2-compliant, because the iOS app never downloads or runs
agent/tool code locally. What we have done instead is:

• Prepare a detailed technical clarification for Resolution Center (thin-client
  boundary, SSH port-forward explanation, demo path).
• Strengthen App Review notes so the first sentence states that no code runs on
  the iPhone.
• Keep a dedicated demo desktop online with a finished sample transcript so
  reviewers can evaluate the companion UI without needing to continue desktop
  tool execution (if an approval appears, Reject is enough).

If App Review can identify the exact screen or action that was interpreted as
installing or launching executable code on device, we will address that specific
item immediately. Please tell us which step led to the finding.

C) Extended Review / “significant safety, security, or quality concerns”

We understand repeated non-compliant submissions can extend review. Our intent
is the opposite: one clear architecture, honest review notes, and no attempt to
bypass review with downloaded app code. EnvoyDev Mobile does not hold model API
keys, does not run agents on the phone, and only talks to a daemon the user
pairs by QR/URI on machines they control. We ask that Extended Review not be
applied as a standing penalty for a 2.5.2 misunderstanding we are trying in good
faith to resolve.

══════════════════════════════════════
4. DEMO PATH FOR RE-REVIEW
══════════════════════════════════════

There is no username/password.

1. Open EnvoyDev Mobile → Add computer → paste the pairing URI (or scan the QR
   if attached).
2. Pairing URI:
   TODO: paste the live envoy://pair?… URI for this review
3. After pair: open the sample project → open the sample task → scroll the
   transcript. Prefer a completed run. If an approval is shown, tap Reject (or
   Confirm); either only sends an RPC to the demo desktop — it does not run
   code on iOS.
4. Demo desktop is online during re-review. Contact: shilei.peng@qq.com

══════════════════════════════════════
5. WHAT WE ARE ASKING FOR
══════════════════════════════════════

1. Escalate this submission to a senior App Review contact who can reconsider
   Guideline 2.5.2 in light of the thin-client architecture above.
2. Prioritize a re-review. After more than 1.5 months, we respectfully request a
   decision within a few business days of this escalation.
3. If you still believe executable code runs on device, please cite the exact
   screen, button, or log evidence so we can fix or clarify that item precisely.

We respect App Review’s role in protecting users. Our concern is the length of
this cycle and a 2.5.2 finding that does not match how the iOS binary behaves.
We are happy to join a call or provide a short screen recording of the
architecture.

Thank you for your help.

Sincerely,
Shilei Peng
EnvoyDev / EnvoyMesh
https://www.envoymesh.cn
shilei.peng@qq.com
shileipeng@gmail.com
```

---

## Tips

- Send via **Resolution Center first**, then open a Developer Support case with
  the same text if you get no reply in a few days.
- Attach: current pairing QR/URI, and the full technical letter in
  `resolution-2.5.2-reply.md` if the form allows files.
- Keep the demo desktop online while you escalate.
- Avoid threats about leaving the Developer Program; ask for escalation and a
  concrete re-review instead — that usually works better.
