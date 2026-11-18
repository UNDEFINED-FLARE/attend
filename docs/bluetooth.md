# Bluetooth check-in evidence

Database update 0037 (`supabase/migrations/20261118000037_bluetooth_evidence.sql`). Indoors, GPS is often too weak to confirm
the venue, so honest students end up in the review queue. Bluetooth adds evidence that the student is in the room.

## The choice

| | Venue beacon (iBeacon / Eddystone) | **Lecturer's phone, rotating signal (chosen)** |
|---|---|---|
| Hardware | A beacon per venue (about R150–R400 each), batteries every 1–2 years, someone to install, register and audit them | None. The lecturer's Android phone with the UniAttend app |
| Setup | Register UUID/major/minor per venue; re-register when a beacon is moved or replaced | An institution switch, then a per-session switch |
| Replay | Cheap beacons broadcast a **fixed** ID: once someone writes it down, it can be sent from anywhere, forever | The value is signed with the session secret for the current 20 s step, like the QR. Old, foreign or made-up values earn nothing |
| Student permission | iBeacon/Eddystone frames are filtered from scans declared `neverForLocation`, so students would have to grant **location** to scan | "Nearby devices" only (`BLUETOOTH_SCAN` with `neverForLocation`); location on Android 11 and older |
| Battery | Beacon: none for phones. Students: ~4 s scan per check-in | Students: ~4 s scan per check-in. Lecturer: low-power advertising only while the session page is open in the app (balanced interval, ~1–3 % an hour on typical phones; **not measured**) |
| Works when the lecturer forgets | Yes | No: then nothing changes, check-in works as before |
| iPhone | Students on iPhone can't scan from the browser either way | Same; iPhone lecturers can't broadcast from the web app |

**Recommendation: the lecturer's phone.** It needs no hardware or venue registry, and it can't be replayed, which a static
beacon can. The trade-off is that a lecturer has to start the broadcast. Beacons can be added later as a second, weaker source
if a university wants fixed hardware. Eddystone-EID would be needed to avoid replay, and that needs per-beacon key provisioning.

Web Bluetooth isn't usable here: iOS Safari has none, Chrome on Android can't scan for advertisements without a flag, and no
browser can advertise. So both sides go through the Capacitor Android app, with its own plugin
(`android/app/src/main/java/za/uniattend/app/UniAttendBlePlugin.java`). There is no npm dependency, because
`@capacitor-community/bluetooth-le` can't advertise.

## How it works

1. An institution admin turns it on at **Admin → Bluetooth** (`set_bluetooth_policy`), and can change the faintest signal
   that counts (default -90 dBm).
2. The lecturer turns it on for a session (`set_session_bluetooth`). With the session page open in the Android app, they tap
   **Broadcast from this phone**. Every 20 s the page fetches `session_ble_token()` and the plugin advertises the 8-byte value as
   service data under service UUID `474a16df-2681-41ef-a326-836b17d9cc8e`. It sends no device name and isn't connectable.
3. The student scans the QR in the Android app. While GPS is read, the phone listens for 4 s for that service only and sends
   `{observations: [{id, rssi}]}` with the check-in. Nothing is sent from a browser or an iPhone, and nothing is saved for an
   offline check-in (the values expire in seconds).
4. `check_in(…, p_ble)` accepts values for the current step and the 2 before (up to 60 s). It ignores malformed readings and
   scores the strongest match:

   | Strongest matching reading | Bluetooth points (of the 40 location points) |
   |---|---|
   | ≥ min + 15 dBm (close) | 36 |
   | ≥ min (in the room) | 30 |
   | weaker (faint) | 6 |
   | 4 or more identical readings (made up) | at most 6 |
   | no match | 0 |

   The location layer becomes `max(gps, bluetooth)`. QR 40 + Bluetooth 30 + device 20 = 90, which is accepted (the default
   threshold is 70). Faint or missing Bluetooth leaves the GPS score unchanged, so a weak check-in goes to review, never to
   absence. A session with no mapped venue doesn't score location at all, so Bluetooth is only recorded there.
5. A summary is kept as `attendance_evidence` of kind `bluetooth`: points, readings, matches, the strongest RSSI, and whether it
   counted. The values heard are never kept.

## Limits

- A student outside the room could get the current value relayed by a friend inside within the minute and send it with a
  modified app. The live QR has the same weakness. Bluetooth helps honest students indoors; it isn't stronger anti-fraud than
  the QR. The device layer and the review queue stay as they were.
- RSSI varies a lot between phone models and bodies in the room. The bands above are a starting point; tune
  `bluetooth_min_rssi` per institution after real use.

## Not yet verified on a real phone

All database logic is covered by PGlite tests (`tests/db/bluetooth.test.ts`) and the helper by unit tests
(`tests/unit/bluetooth.test.ts`). None of the following has been run on a device:

- The Java plugin: permission prompts on Android 12+ and 11-, scanning with a service-data filter, advertising, restarting
  the advertisement every 20 s, and its behaviour when Bluetooth is off.
- Whether `neverForLocation` filters this custom service-data frame on any vendor's Android build.
- Real RSSI values in a lecture hall, the range of a phone's advertisement, and battery use.
- That the plugin is reachable from the remote-URL web view (`window.Capacitor`), as the other plugins are.

Test plan: two Android phones on the same session. One broadcasts. Check in with the other inside the room, at the door and
at about 30 m outside, with location both on and off. Check the review queue and the evidence rows.
