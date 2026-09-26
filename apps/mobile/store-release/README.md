# EnvoyDev Mobile — Store Release Pack

Ready-to-paste listing copy and icon assets for **Apple App Store** and **Google Play**.

```
store-release/
├── README.md                 ← this summary
├── apple_google_reviewing.md ← store review: demo desktop + pairing QR
├── appstore/
│   ├── listing.md            ← all App Store Connect text
│   ├── icons/                ← App Store icon assets
│   └── screenshots/          ← reference phone shots (re-capture at store sizes)
├── googleplay/
│   ├── listing.md            ← all Play Console text
│   ├── icons/                ← Play icon + feature graphic
│   └── screenshots/          ← same reference shots
└── shared/                   ← master logo references

play-store-assets/            ← convenience copies of Play graphics (EnvoyGo layout)
├── icon-512.png
└── feature-graphic-1024x500.png
```

## Quick facts

| Field | Value |
|-------|--------|
| App name | **EnvoyDev** |
| Version (current) | `0.1.0+1` (`apps/mobile/pubspec.yaml`) |
| iOS bundle ID | `com.envoymesh.envoydev` |
| Android application ID | `com.envoymesh.envoydev` |
| Category (suggested) | Developer Tools / Productivity |
| Price | Free |
| Age rating (suggested) | 4+ / Everyone |
| Marketing / Website | https://www.homeclaw.cn/envoy |
| Privacy Policy | https://www.homeclaw.cn/envoy/privacy |
| Support | https://github.com/allenpeng0705/EnvoyCoder/issues |
| Play contact email | `shilei.peng@qq.com` (alternate `shileipeng@gmail.com`) |

## What EnvoyDev Mobile is (one line)

Thin-client companion for the **EnvoyDev** desktop control plane — pair by QR, then watch coding agents, answer approvals, and steer runs on machines you already own. No central account.

## Icons & listing — status

| Asset | Status | Notes |
|-------|--------|--------|
| App Store `1024×1024` | present | Opaque RGB, corners filled (Apple applies the mask). Source: `apps/mobile/assets/logo.png`. |
| Play Store `512×512` | present | Opaque RGB (Play rejects transparency). |
| Play feature graphic `1024×500` | present | Logo + wordmark on brand charcoal. |
| Screenshots (reference) | present | `appstore/screenshots/` + `googleplay/screenshots/` — projects, live run, connection. **Re-capture on device** at each store’s required resolutions before upload. |
| Privacy Policy URL | filled | Family page now includes an **EnvoyDev** section (`EnvoyMesh/sites/privacy.html`). Deploy that file to homeclaw before store submit if the live page still omits EnvoyDev. |
| Support / Marketing URLs | filled | See listing.md files. |

## Suggested next steps

1. Deploy updated `EnvoyMesh/sites/privacy.html` to https://www.homeclaw.cn/envoy/privacy so the live page matches source.
2. Re-capture **screenshots** at App Store / Play pixel sizes (checklists in each `listing.md`).
3. Configure **release signing** for Android (upload keystore + `key.properties`).
4. Spin up a **demo EnvoyDev desktop** with a long-lived pairing QR — see `apple_google_reviewing.md` — and paste the URI into store review notes.
5. Upload builds via App Store Connect / Play Console and paste text from the listing files.
