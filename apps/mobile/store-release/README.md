# EnvoyDev Mobile — Store Release Pack

Ready-to-paste listing copy and icon assets for **Apple App Store** and **Google Play**.

```
store-release/
├── README.md                 ← this summary
├── apple_google_reviewing.md ← store review: demo desktop + pairing QR
├── appstore/
│   ├── listing.md            ← all App Store Connect text
│   └── icons/                ← App Store icon assets
├── googleplay/
│   ├── listing.md            ← all Play Console text
│   └── icons/                ← Play icon + feature graphic
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

## What EnvoyDev Mobile is (one line)

Thin-client companion for the **EnvoyDev** desktop control plane — pair by QR, then watch coding agents, answer approvals, and steer runs on machines you already own. No central account.

## Icons — status

| Asset | Status | Notes |
|-------|--------|--------|
| App Store `1024×1024` | ✅ present | Opaque RGB, corners filled (Apple applies the mask). Source: `apps/mobile/assets/logo.png`. |
| Play Store `512×512` | ✅ present | Opaque RGB (Play rejects transparency). |
| Play feature graphic `1024×500` | ✅ present | Logo + wordmark on brand charcoal. |
| Screenshots | ❌ TODO | Capture on device; checklist in each `listing.md`. |
| Privacy Policy URL | ❌ TODO | Required by both stores — fill placeholders. |
| Support URL | ❌ TODO | Fill placeholders. |

## Suggested next steps

1. Fill **Privacy Policy** + **Support** URLs in both `listing.md` files.
2. Capture **screenshots** (phone) per the checklists — you said you will do these manually.
3. Configure **release signing** for Android (upload keystore + `key.properties`).
4. Spin up a **demo EnvoyDev desktop** with a long-lived pairing QR — see `apple_google_reviewing.md` — and paste the URI into store review notes.
5. Upload builds via App Store Connect / Play Console and paste text from the listing files.
