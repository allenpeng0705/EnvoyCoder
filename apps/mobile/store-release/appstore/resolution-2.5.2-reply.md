# App Review Resolution Center — Guideline 2.5.2 reply

Copy everything inside the block below into App Store Connect → Resolution Center
(reply to the rejection). Replace the `TODO:` lines before sending. Keep the demo
desktop online while they re-review.

Do **not** submit a new binary solely for this clarification unless they ask for one
or you already have unrelated fixes (e.g. Info.plist purpose strings) ready in the
same build. For a pure 2.5.2 misunderstanding, a Resolution Center reply is the
right first step.

---

```text
Hello App Review Team,

Thank you for reviewing EnvoyDev Mobile, and thank you for your patience with this
submission. We understand the concern under Guideline 2.5.2 and want to clarify the
architecture carefully, because we believe this finding is based on a
misunderstanding of where work runs.

SUMMARY
EnvoyDev Mobile does not download, install, or execute executable code on the iOS
device. It is a thin companion UI for an EnvoyDev desktop app that the user already
runs on their own computer. Coding agents, shells, and tool calls run only on that
paired computer. The iPhone app only displays transcripts and sends high-level
control messages (pair, open project/task, send a message, Confirm/Reject an
approval). Nothing in the iOS binary loads downloaded native code, runs a local
interpreter for app features, or uses OTA / CodePush / plugin download mechanisms.

WHY THIS IS NOT A 2.5.2 VIOLATION
Guideline 2.5.2 requires apps to be self-contained and prohibits downloading,
installing, or executing code that introduces or changes the app’s features on the
device. EnvoyDev Mobile:

1. Ships as a single Flutter/iOS binary reviewed as submitted. There is no mechanism
   to download additional app code, dylibs, frameworks, scripts that alter the app,
   or feature packs after install.
2. Does not embed a user-facing shell, terminal emulator, or code interpreter that
   runs on iOS.
3. Does not use hot updates, CodePush, Expo Updates, JS bundle OTA, or similar.
4. Does not write outside its sandbox or attempt to circumvent iOS security.

Any “shell”, “tool”, or “agent” activity a reviewer may have seen in the UI is a
remote transcript of work that already ran (or is running) on the paired EnvoyDev
desktop daemon — analogous to a remote status / messaging client showing what
happened on another machine, not to an on-device code runner.

HOW THE PRODUCT WORKS (ARCHITECTURE)
• EnvoyDev desktop (Mac / Windows / Linux) hosts a local daemon and runs coding
  agents against projects on that computer. Model API keys, repositories, and
  command execution stay on that computer.
• EnvoyDev Mobile pairs to that daemon with a QR code or pairing URI
  (envoy://pair?…). There is no central EnvoyDev account and no EnvoyDev cloud that
  runs agents for the user.
• After pairing, the phone uses encrypted network RPCs / WebSocket to the user’s
  own daemon to list projects, show a task transcript, queue a follow-up message,
  or answer an approval prompt.
• If the transcript shows a tool named “shell” (or similar), that tool executed on
  the desktop. Tapping Confirm/Reject only sends an approval decision to the
  desktop; the phone does not spawn a local process for that tool.

ABOUT SSH (IF MENTIONED IN METADATA)
Optional SSH support on the phone is only a local port-forward so the app can reach
the user’s desktop daemon when it is not on the same LAN. It is not an interactive
remote shell inside the iOS app, and it does not install or launch code on the
iPhone.

ABOUT APPROVALS AND “LAUNCHING” CODE
If during review an approval card appeared (for example asking whether to allow a
tool on the desktop), choosing Confirm does not execute code on iOS. It tells the
already-running desktop agent to continue. Choosing Reject tells it to stop. For
review convenience we recommend opening a finished sample task and reading the
transcript; if an approval is pending, Reject is enough to exercise the UI without
continuing desktop work.

DEMO PATH FOR RE-REVIEW
There is no username/password. Please use the demo pairing below.

1. Open EnvoyDev Mobile → Add computer → paste the pairing URI (or scan the QR if
   attached).
2. Pairing URI:
   envoy://pair?pairing=H4sIAAAAAAAAE7WTS5OaUBCF_8pUb4P3wUugKgtFHWUY4ogjQzJZcK9iQAN35E0q_z2F2SSprFKml119vjp9qvsb1GBRCZoCLGgKC2NqyojqBlKQoVnqeExwU4AEZX4CC57SF3oK4-b0cvFtEldzsjEfY7Jvd1pJ35oSJMiTPVhwyOq8s_ImO1ysc86j88igXNfYnjL9oHJN0wbmdZTKM-Uhz4NFMa23nR0nTp0EVHds5raL6Nh9PPFtsq7iUN4-Z1x3fX9SgwRMgPUJcCJUTOUxIoggiksusK4QImMhC_yP5J_MX2K4IVYdI1NBlCKZylesSgj9jep6GzUIg-W0aA5G1Wp9UHQ6r-67JgvXDtuzaMKY-Oo8piwfhCOeXHiVlLewJmsUmRSZ479bmwTJzheFnYo0qnpDSVK3OraNzzdOYpieup7Q3RO1-yLj7NbWbpja_1kYPksQCQEWzIfbnx0G97kYvmY01HR-v_Lu1s9Td2XfPczDa_M1y1Zp5vY9DzzNv1DXL3fH9AszF60ffSiW5_74brbtsLPEZPX-NbuK5t7sTw58_wGxrReYyQMAAA
3. After pair: open the sample project → open the sample task → scroll the
   transcript. Prefer a completed run. If an approval is shown, tap Reject (or
   Confirm); either only sends an RPC to the demo desktop.
4. Demo desktop is online during re-review. Contact: shilei.peng@qq.com
   Alternate: shileipeng@gmail.com
5. Architecture demo video: https://youtu.be/DFoRIRMSHCU

Notes:
• First connect can take a short time while the app tries LAN / mesh / relay
  candidates (reviewers are usually on cellular).
• The phone never runs an agent and never holds a model API key. The iOS app does
  not call third-party AI APIs; any model/tool work stays on the user’s computer.
• This pairing URI is for App Review only.

PERMISSIONS (UNRELATED TO 2.5.2, FOR CONTEXT)
• Camera — scan the desktop pairing QR
• Photo Library — optional image attach on a message
• Microphone / Speech Recognition — optional dictate into the message composer
  (prompted only when the user taps the mic)

REQUEST
Please reconsider Guideline 2.5.2 in light of the above. EnvoyDev Mobile is
self-contained on iOS; executable agent/tool work occurs only on the user’s paired
computer, which is outside the iOS app sandbox and is not code downloaded into the
iPhone app to change its features.

We are happy to join a call, provide a short screen recording of the architecture,
or answer any specific question about a screen or log line that led to this finding.

Thank you again for your time on this review.

Best regards,
Shilei Peng
shilei.peng@qq.com
Alternate: shileipeng@gmail.com
App: EnvoyDev
Bundle ID: com.envoymesh.envoydev
```

---

## Operator checklist before you hit Send

- [ ] Live `envoy://pair?…` URI pasted (desktop online, cellular-reachable)
- [ ] Sample project + **completed** transcript ready (avoid a pending shell approval
      if you can; if one remains, note that Reject is fine)
- [ ] Contact email monitored for the next several days
- [ ] Attach QR PNG in Resolution Center if the form allows
- [ ] Confirm bundle ID matches App Store Connect
- [ ] If you also fixed Info.plist mic/speech strings, upload that build **and**
      mention the build number in the reply (“Build N also includes privacy string
      fixes”); otherwise reply first without a new binary

## If they reject again on 2.5.2

1. Ask which exact screen/action they believe executes code on device.
2. Offer a recorded walkthrough: pair → open finished transcript → show that no
   local process starts.
3. Soften public listing language that sounds like an on-device IDE/terminal
   (subtitle/keywords); keep “agents run on your computer” as the first sentence
   of the description.
4. Escalation: request a call with App Review / mention you can demonstrate the
   thin-client boundary live.
