# UniAttend Check

A small test app that checks whether a device can do what UniAttend needs:

| Check | Android app | Web app (browser) |
|---|---|---|
| Notification sound + vibration | Real Android notification on a high-priority channel, plus vibration | Browser notification, test chime; vibration on Chrome for Android only |
| Wi-Fi | On/off, connected, network name; opens the Wi-Fi panel | Online/offline only (browsers hide Wi-Fi details) |
| Bluetooth | On/off, "Turn on" prompt, scan nearby devices | Pick one nearby device (Chrome/Edge only) |
| GPS | Location, accuracy, live tracking, location settings | Location, accuracy, live tracking |
| Map | OpenStreetMap; tap to place a classroom pin and see inside/outside the check-in radius | Same |

One codebase (Vite + React + TypeScript) builds both. The Android app wraps the
same web code with Capacitor and adds a small native module
(`android/app/src/main/java/com/uniattend/devicecheck/DeviceStatusPlugin.java`)
for Wi-Fi and Bluetooth.

It is a standalone project with its own `package.json`. It is not part of the
UniAttend Next.js build: the root `tsconfig.json` and `eslint.config.mjs` exclude
`tools/device-check`, so Vercel ignores it.

## Run the web app

```
cd tools/device-check
npm install
npm run dev
```

Open http://localhost:5173. (Camera, location and Bluetooth need `localhost` or HTTPS.)

## Run the Android app

Needs: the Android SDK (`ANDROID_HOME`), JDK 21 (`JAVA_HOME`; Capacitor 8 uses Gradle 8.14, which
doesn't run on newer JDKs), and an emulator or a phone with USB debugging.

```
npm run android:run
```

That builds the web app, copies it into `android/`, compiles the APK and installs it on the
connected device. `npm run android:open` opens the project in Android Studio instead.

## Notes

- Emulators often have no working Bluetooth (on older CPUs without AVX2 the emulator's
  Bluetooth simulator can't run and has to be disabled). Test Bluetooth on a real phone.
- The app ID is `com.uniattend.devicecheck`, separate from the main app (`za.uniattend.app`),
  so both can be installed side by side.
- On the emulator, vibration can't be felt and GPS is simulated. Set a location with
  `adb emu geo fix <longitude> <latitude>` or the emulator's "Extended controls > Location".
- Map tiles come from OpenStreetMap's public servers, which are fine for testing. For a
  production app, use a tile provider (or Google Maps with an API key).
