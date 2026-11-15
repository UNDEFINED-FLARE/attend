# 08 — Mobile test report

*15 November 2026.*

> **No real-device testing has been done.** The Android app has only been built as a debug APK. Every result below is **PENDING**. Nothing here is a claim that the app works on any particular phone.

## 1. What the app is

- A Capacitor 8 Android shell that loads the UniAttend web app from its https address (`mobile/app.json`), so every rule and permission check stays on the server.
- `minSdkVersion 24` (Android 7.0) to `targetSdkVersion 36`.
- Native parts: local notifications (class reminders), and an app lock using the phone's own fingerprint or face check (`@capgo/capacitor-native-biometric`). **The biometric check happens only on the phone; UniAttend never receives or stores biometric data.**
- QR scanning uses the browser camera inside the app (`html5-qrcode`). Location uses the browser geolocation API.
- Offline: a check-in made without signal is kept on the phone with its evidence and sent later; the server never accepts it automatically — it goes to review (migration 0020).
- Not built yet: a signed release build, Play Store listing, push notifications to a closed app (Firebase Cloud Messaging).

## 2. Devices to test

Budget and mid-range phones common among South African students, plus one recent flagship:

| Group | Examples | Android |
|---|---|---|
| Entry level | Samsung Galaxy A05/A05s, Hisense, Mobicel, Tecno Spark, Itel | 11–14 (some Go edition) |
| Mid range | Samsung Galaxy A15/A25, Xiaomi Redmi Note, Oppo A-series | 13–14 |
| Older but common | Samsung Galaxy A10/A20 | 9–11 |
| Recent | Samsung Galaxy S or Pixel | 14–15 |
| iPhone (web app in Safari) | iPhone 11 or newer | iOS 17+ |

## 3. Test cases

| # | Test | Pass when | Result |
|---|---|---|---|
| M1 | Install, sign in, sign out, session expiry | Sign-in survives an app restart; expiry returns to sign-in without losing work | PENDING |
| M2 | Camera permission: allow, deny, deny then allow in settings | Clear message on deny; the typed code works if the institution allows it | PENDING |
| M3 | QR scan in a lecture hall (projector glare, distance 5–20 m) | Scans within 5 s on ≥ 95% of phones | PENDING |
| M4 | Location permission: allow, deny, approximate only | Deny or approximate goes to review with a reason, never absent | PENDING |
| M5 | Location accuracy indoors, ground floor and upper floor | Record the reported accuracy per phone; compare with the institution's limit | PENDING |
| M6 | Offline check-in: flight mode, scan, reconnect | Sent once on reconnect; appears as pending review; no duplicate | PENDING |
| M7 | Class reminders and announcements | Arrive while the app is open and in the background; settings respected | PENDING |
| M8 | App lock: enrol, unlock, fail, phone with no biometrics | Falls back to the phone's PIN or to signing in; no biometric data leaves the phone (check network traffic) | PENDING |
| M9 | Background and resume | Returning after 30 minutes shows fresh data; no crash | PENDING |
| M10 | Low-end performance | Check-in screen usable within 3 s on an entry-level phone on 3G | PENDING |
| M11 | Low storage, battery saver, data saver | Check-in still works | PENDING |

For each device record: model, Android version, app version, network (Wi-Fi, 4G, 3G), and pass/fail with a note.

## 4. Before testing

1. Build a debug APK (GitHub Actions artifact or `npm run android:build`; see [`docs/android-app.md`](../android-app.md)).
2. Point it at staging, not production.
3. Create test accounts in a test institution; never use real students' accounts for device testing.
