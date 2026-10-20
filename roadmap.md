# Roadmap

- [x] Match video: position action strip, SL/TP draft dragging, explicit modification sheet (mobile demo flow verified)
- [x] Chart drawing controls: smooth select/move/delete, MT5-style
- [x] Chart settings, radial dial (double-tap), indicators, objects
- [x] Filled green candles, no Bid/Ask text, candle countdown (settings-gated)
- [x] Trade history markers entry→exit, SL/TP drag with P/L tooltip
- [x] Offers page for guests, direct chart entry for signed-in users
- [x] Hidden positive-spread bonus on close (non-DEMO, min 1 min hold)
- [x] Price alerts + dashed alert lines on chart
- [x] Existing email authentication and JSON cloud sync integration (hosted auth settings/security remain unverified)
- [ ] Cloud authorization hardening (live schema/RLS audited; user-owned JSON and client audit inserts remain unsafe; production migration requires an approved server-side replacement plan)
- [ ] Independent staff application (blocked: verified server-side roles and account-state authorization; preserve current authenticated portal)
- [x] Existing Capacitor wrapping, deep links, and Android back handling; automated callback/scheme tests added
- [ ] Installable Android/iOS release (blocked: no Android SDK/device or Xcode/device is available here; Capacitor sync and static deep-link checks pass)
- [x] Global ESLint formatting errors fixed; lint has zero errors (six existing React Fast Refresh warnings remain)
- [x] 10 simulated 2-step $10,000 accounts created (cloud-synced)
- [ ] Server engine tables + 24/7 monitor (blocked: user must run engine SQL in DB SQL editor and deploy on Render)
