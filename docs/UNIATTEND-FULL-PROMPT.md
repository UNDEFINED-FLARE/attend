# UniAttend — Full Description of the Platform

> Use this document as a complete prompt or brief: it explains what UniAttend is, who uses it, every function
> it offers, how the data and security work, and how it is deployed. It describes the app as built in
> `UNDEFINED-FLARE/attend` at commit `05600a5` (9 November 2026).

---

## 1. What UniAttend is

UniAttend is a **multi-institution attendance platform for universities and colleges**, **institution-neutral**:
no university is built into the code. It is sold to South African universities, universities of technology and
TVET colleges as a subscription service; each institution's campus map and timetable link are set up by the
platform owner (super admin) when the institution is approved.

Lecturers open an attendance session and project a **QR code that is re-signed every 20 seconds**. Students
check in with their phones. The server, never the phone, decides each check-in from three kinds of evidence:

1. **The signed QR token** — proves the student saw the live code (a forwarded screenshot expires within seconds).
2. **GPS location** — compared with the mapped venue (building outline or radius), weighted by the phone's own accuracy.
3. **A privacy-preserving device hash** — flags one phone checking in several students, without blocking someone who changed phones.

When the evidence is weak, the check-in goes to the lecturer **for review**. It is **never** turned into an
absence automatically. Attendance percentages count only resolved sessions, so "we couldn't verify" never
silently becomes "was not there".

Around this core, the platform manages each institution's academic structure, timetables, campus map, people,
reports, subscriptions and its own visual design.

---

## 2. Technology

| Layer | Technology |
|---|---|
| Web app | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| Database, auth, realtime | Supabase (PostgreSQL 17, Supabase Auth, Realtime) |
| Maps | Leaflet with OpenStreetMap street tiles and Esri satellite imagery; building data from OpenStreetMap (Overpass API) |
| PDF reading | pdf.js (server-side) |
| Hosting | Vercel (from the GitHub repository `UNDEFINED-FLARE/attend`, branch `main`) |
| Payments (prepared) | Paystack webhook as a Supabase Edge Function |
| Tests | Vitest; database tests run the real migrations in PGlite (in-process PostgreSQL) |

All UniAttend data lives in its own PostgreSQL schema, **`uniattend`**, so it can share a Supabase project with
other apps without name clashes.

---

## 3. Who uses it (roles)

Roles are **granted, never claimed**: signing up gives an account and nothing else. Access is linked from
records an administrator created.

| Role | Scope | What they do |
|---|---|---|
| **Super admin** (platform owner) | Whole platform | Approve, suspend and reactivate institutions; manage subscription plans and prices; set each institution's plan; publish platform-wide announcements; see platform statistics. |
| **Institution admin** | One institution | Run everything for their institution: structure, venues and map, modules, timetable, lecturers, students, enrolments, attendance policy, design, audit log. |
| **Lecturer** | Modules assigned to them | Open attendance sessions, project the live QR, watch the register update live, correct records, resolve disputes, view and export module reports. |
| **Student** | Modules they are enrolled in | Check in, see attendance and percentages, timetable, campus map with live and upcoming classes, history, disputes, notifications. |

A person can hold roles at more than one institution and switch between them from the top bar.

**How accounts get linked:**
- An admin adds a student (student number, name, email) or lecturer (staff number, name, email).
- The person signs up with that email and confirms it.
- On sign-in, the platform links them to their record and grants the matching role.
- Students can also be linked when their email is on a verified institution domain and the part before the
  `@` is their student number (e.g. `22012345@students.example.ac.za`).

---

## 4. Functions by area

### 4.1 Public pages
- **Landing page** — what UniAttend does, sign in, create account, register an institution.
- **Sign in / Create account / Forgot password / Reset password** — email and password through Supabase Auth.
  Sign-up requires accepting the privacy notice. Error messages never reveal whether an email exists.
- **Privacy notice** — plain-language POPIA notice: what is collected (account details, attendance, location
  distance at check-in only, device hash, optional sound fingerprints), fairness rules, who can see data,
  retention and rights.
- **Get set up (onboarding)** — for signed-in users without a role. Students and lecturers can re-check
  whether their institution has added them. Institution admins can apply to register an institution (name,
  short name, contact email); it starts as *pending* until the super admin approves it.

### 4.2 Everyone signed in
- **Responsive shell** — on desktop, an icon sidebar and a top bar with the date, notification bell (unread
  count), avatar and institution switcher. On phones, a bottom tab bar. The institution's design (section 4.7)
  styles the whole shell.
- **Notifications** — in-app messages:
  - for students: attendance opened, checked in, sent for review, correction made, dispute decided;
  - for lecturers: new dispute;
  - for admins: institution status changes.
  "Mark all read" clears them.
- **Resilience** — if Supabase can't be reached, pages show "This page could not load, try again" instead of
  logging the user out. A friendly 404 page exists.

### 4.3 Student functions
- **Home**, laid out by the institution's design. Each card can be shown, hidden, renamed or reordered:
  - **Greeting** — "Good morning/afternoon/evening, {name}", customisable.
  - **Attendance summary** — a progress ring with overall attendance; "on track" or "below requirement in
    …"; items awaiting review (which don't count against the student).
  - **Check-in prompt** — a green "Happening now" card when a lecturer has opened attendance, otherwise
    "Open scanner".
  - **Quick actions** — Check in, History, Timetable, Campus map.
  - **Today's classes** — a scrolling strip from the timetable, highlighting the class happening now.
  - **My modules** — colour-coded cards with attendance %, sessions attended and the required %.
  - **Recent** — the latest attendance records with status.
- **Check in** — a scanner screen with a framed camera view and scan line.
  - Students scan the projected QR with the in-app camera, or open the QR's link from the phone's own camera
    app, which checks in automatically. A six-character code can be typed instead.
  - The phone collects several GPS readings and a device hash in parallel, then sends them to the server.
  - Results:
    - **Checked in** (present or late), with a confidence score.
    - **Sent for review**, with plain-language reasons (e.g. "about 550 m outside the venue").
    - **Already recorded**.
    - **Not recorded**, when the QR has expired.
  - A **map** shows the venue and the student's own position, marked inside or outside. That position is
    drawn on the phone only.
- **Timetable** — "Now" and "Next today" cards, plus the full week (Monday–Friday, or Saturday and Sunday when
  used) for every module the student is enrolled in. Today is highlighted, and each class shows its time,
  code, type, group and venue.
- **Campus map**:
  - Every mapped venue on a satellite map, colour-coded: a class on now, the student's own classes, or other
    venues. Live labels name the module in each venue, and a pulsing dot marks where attendance is open.
  - Tapping a venue lists all its classes today, with lecturers.
  - **Up next for you** — the student's next classes with countdowns ("in 25 min", "Now"), rolling over to
    tomorrow, with venue and lecturer. Tapping one flies the map there.
  - **Happening now on campus** — every class currently in session.
  - **Show my location** — a live GPS dot that names the venue the student is in, plus a dashed line to the
    next class with distance and walking time. This stays on the phone.
  - The clock updates by itself, so "now" stays current.
- **History & disputes** — every attendance record with status and explanation. Students can dispute any
  absent, late or pending record with a written reason, and see each dispute's outcome.

### 4.4 Lecturer functions
- **Home**:
  - A green "Live now" card for open sessions, with a button to show the QR and register.
  - Stat tiles: modules, students, sessions this week, items to review.
  - Module cards with 30-day attendance bars.
  - Recent sessions.
- **Module page**:
  - **Start attendance:** choose a title and venue (a mapped venue enables the GPS check), how long it stays
    open and when check-ins count as late.
  - **Sessions list** and **attendance report**: per student attended / late / absent / excused / pending,
    with the percentage over resolved sessions and the **worst case** (if every pending record were an
    absence). At-risk students are highlighted.
  - **Export CSV**, protected against spreadsheet formula injection.
- **Live session page**:
  - The **QR** re-signs every 20 seconds, with the join code underneath and a full-screen projector mode.
  - The **register** updates live through Supabase Realtime, with a slow poll as a fallback. Each student
    shows status, time, confidence score and the reasons for review.
  - Counters for present, late, to review and not yet in.
  - A **venue map**.
  - **Correct a record:** present, late, excused or absent, with a required reason. Corrections are audited
    and the student is notified.
  - **Close session:** students who never checked in become absent; pending records stay pending for a
    decision.
- **Disputes & reviews** — decide open disputes (uphold as present, late or excused, or reject, with a note
  to the student), and see check-ins awaiting review with links to the register.

### 4.5 Institution admin functions
- **Dashboard**, computed by one SQL query so it stays fast at any size:
  - stat tiles for present today, absent today, late arrivals and the attendance rate compared with yesterday;
  - a **chart** of today's check-ins by hour, or the 14-day attendance trend;
  - a **location-check donut** over 30 days (inside the venue, outside, no location);
  - **attendance by department** with bars;
  - **recent check-ins** with status and method;
  - links to students, lecturers, modules and the subscription plan.
- **Venues & map**:
  - **Auto-map venues** matches the timetable's buildings to named places on OpenStreetMap, with a confidence
    for each (exact, likely, best guess). The admin ticks buildings to apply, and every room in a ticked
    building is placed at once. Unmatched buildings are listed for placing by hand.
  - **Campus map editor**: the institution's own campuses (set up by the super admin), with satellite and
    street views. Until campuses are set up the map shows the venues already placed, or South Africa. Placement tools:
    - **Pick a building** — click an OpenStreetMap footprint to take its outline and name.
    - **Draw outline** — click corners.
    - **Centre + radius**.
    - **Use my location** — averages several GPS readings while standing in the hall.
  - **Auto-geofence this campus** — create many venues at once from the campus's named buildings.
  - Edit or remove any venue by clicking it. Faculties and departments are added and deleted here too.
- **Modules**:
  - Add a module, assign lecturers (primary or assistant), and enrol or remove a student by student number.
  - A searchable list shows department, enrolled count, expected class size, weekly hours, required % and
    assigned lecturers (each removable).
  - **Edit** code, title, department, required % or class size inline; **delete** a module.
- **Timetable**:
  - **Import from your timetable source** (shown when the super admin has set one): load the catalogue
    (programmes from a timetable viewer, or the PDF files linked from the institution's timetable pages),
    filter and select, and fetch in batches with progress.
  - **Import a timetable PDF** exported from a timetable system. Two layouts are read: the block layout
    (code / time / building @ room / lecturer) and CELCAT Timetabling (including rotated pages, wrapped
    lines, 12- or 24-hour times, room capacity and online classes). Overlapping classes are read
    correctly, and impossible times are rejected rather than guessed.
  - Both imports show a **preview** first: classes by day, new modules and venues flagged, lecturers matched.
    Options:
    - create missing modules;
    - create missing venues (with building and capacity);
    - create missing lecturers;
    - link lecturers to modules and classes;
    - update module class sizes;
    - replace the selected modules' existing timetable.
  - Re-imports skip classes already present, and venue clashes are reported while the rest go in.
  - **Add a class by hand**: module, days (several at once), start and end, venue, type (lecture, tutorial,
    practical, test or other) and group. **A venue cannot be double-booked**, and the database names the clash.
  - A **week grid** for the whole institution or one module, with a remove button on every class.
- **People**:
  - **Add students** three ways:
    - **one student**, with module checkboxes;
    - **paste a list** (comma- or tab-separated, straight from Excel, optional module for everyone);
    - **upload a CSV** (up to 10,000 rows).
    All three use one database import with duplicate protection, the institution's student-number format,
    module checks and plan limits.
  - **Add a lecturer.**
  - Lists of lecturers and students with sign-up status. Lecturers created from a timetable are flagged until
    they have a real staff number and email.
  - **Edit** (number, name, email) and **delete** on every row.
  - **Administrators:** add another admin by email.
- **Design** — see 4.7.
- **Policy & branding**:
  - required attendance %, late threshold, require the live QR, allow typed codes, check location;
  - default venue radius, worst usable GPS accuracy, accept score, review threshold;
  - **record retention** (POPIA);
  - institution name, brand colour, student-number format (regular expression).
- **Audit log** — read-only history of role changes, corrections, imports, session openings and closings,
  status and subscription changes.

### 4.6 Super admin (platform owner) functions
- **Platform overview** — active and pending institutions, students, lecturers, sessions and check-in
  attempts over 30 days (including rejected ones).
- **Approve** pending institutions; **suspend** or **reactivate** active ones. Admins are notified.
- **Change any institution's subscription**: plan, status (trialing, active, past due, suspended, cancelled)
  and end date.
- **Plans & pricing**: Starter, Professional and Enterprise, each with a name, price (blank means "contact
  sales"), monthly or yearly billing, and student, lecturer and module limits. Feature flags cover bulk
  import, advanced analytics, the acoustic layer, custom policies, PDF exports and SSO.
- **Platform announcements** to everyone, admins, lecturers or students.
- **Institution directory** (Super → Directory): known institutions with their campuses (centre, zoom and
  OpenStreetMap outline) and timetable link. Seeded with 14 institutions: University of Venda, Tshwane
  University of Technology, University of Limpopo, Central University of Technology, and the Limpopo TVET,
  agricultural and nursing colleges. Entries can be added, edited, tested and removed.
- **Set up an institution** (Super → Institutions → Set up):
  1. apply a directory entry (suggested by name) to copy its campuses and timetable link;
  2. adjust the campus map: search places, click to place, draw outlines, add or remove campuses;
  3. set the timetable source (*none*, *timetable viewer (JSON API)*, *pages that link to timetable PDFs*,
     or *a single PDF*) and **test** it, which shows how many programmes or PDFs were found and a sample;
  4. approve. Only the super admin can change an institution's timetable source.

### 4.7 Platform designer (institution admin → Design)
Each institution designs its own platform, with a **live desktop and phone preview**:
- **Styles:** Navy (default), Maroon & gold, Forest, Ocean, Royal.
- **Colours:** main, highlight, page background, cards, text, secondary text, success, warning, danger.
- **Shape and lettering:** corners (sharp, rounded, soft) and font (clean, friendly, classic, technical).
- **Header:** light, solid or gradient; custom title and subtitle; logo from an `https://` image link; date on
  or off.
- **Side menu:** light, dark or the main colour.
- **Announcement banner:** a message with a colour (info, good news, notice, urgent).
- **Footer:** text plus up to 6 links (`https://`, `mailto:` or in-app paths).
- **Student home:** greeting template, summary card title and gradient colours, and every card (summary,
  check-in prompt, quick actions, today's classes, my modules, recent) **reordered, renamed or hidden**.

Saving applies the design to everyone at the institution. Unsafe links such as `javascript:` are rejected, and
a broken or outdated saved design falls back to safe defaults section by section.

---

## 5. Attendance engine (how a check-in is decided)

The `check_in` database function is the only way a student's attendance is written. It takes the session (or
a typed code), the QR token, the GPS samples and the device hash. It:

1. **Identifies the student** from the authenticated user and the session's institution, never from client
   input. It also checks enrolment, that the session is open, and that the institution is active and
   subscribed.
2. **Rate-limits** to 5 attempts per student per session per minute.
3. **Blocks duplicates.** A unique constraint means one record per student per session; a pending record can
   be improved by a better attempt.
4. **Scores** out of 100:
   - **Session proof (40):** a valid live QR earns 40; a typed code (if allowed) earns 15. Without one, the
     attempt is rejected and nothing is recorded. Tokens are HMAC-SHA256 over `session:step`, with 20-second
     steps; the current and previous step are accepted.
   - **Location (40):** the probability of being inside the venue's outline or radius, given the phone's
     reported accuracy. It's capped when accuracy is poor or the readings look synthetic. Coordinates are
     **not stored**; only distance and accuracy are kept.
   - **Device (20):** zero if this device already checked in another student in the session; reduced if
     several students used it recently.
5. **Decides:** at or above the institution's accept score, the student is **present**, or **late** after the
   late threshold. Below it, the record is **pending verification** for the lecturer. Every attempt (accepted,
   review, rejected or duplicate) is logged with its reasons.

Statuses: present, late, absent (only when a session closes), excused, pending verification, disputed.

---

## 6. Data and security

- **Tenancy:**
  - Every institution-owned row carries `institution_id`.
  - **Row Level Security** is on for every table.
  - **Composite foreign keys** stop a row from pointing at another institution's data, even with a forged ID.
  - Tested: Institution A cannot read or write Institution B through any table or function.
- **Server-decided outcomes:** clients never send a role, institution or attendance status that is trusted.
  Privileged work happens in `SECURITY DEFINER` functions that check `auth.uid()`, and the service-role key is
  never in the web app.
- **QR signing secret:** in a table with no access policies, readable only by database functions.
- **Corrections** go only through functions that set the audit fields themselves, so they can't be forged.
- **Plan limits** are enforced in the database for students, lecturers and modules.
- **Timetable clashes:** a database trigger rejects overlapping classes in the same venue.
- **Deletion:** records with attendance history are archived rather than erased, so reports stay correct.
- **Privacy (POPIA):**
  - GPS coordinates are not stored, and the device identifier is hashed on the phone.
  - Optional sound fingerprints (tables prepared) would be deleted after matching.
  - Retention period is configurable.
- **Web hardening:** security headers (HSTS, `nosniff`, frame denial, permissions limited to camera,
  geolocation and microphone on the same site), CSV formula-injection protection, input validation with Zod
  on every server action, validated links in the designer.

### Main tables (schema `uniattend`)
- **Institutions:** `institutions` (with `theme`, `directory_id`), `institution_settings` (with the timetable
  source), `institution_domains`, `institution_directory` (super admin only).
- **People and access:** `profiles`, `user_roles`, `students`, `lecturers`.
- **Academic structure:** `campuses`, `venues` (outline/radius, building, capacity), `faculties`,
  `departments`, `academic_programmes`, `academic_periods`.
- **Teaching:** `modules` (with expected class size), `module_enrolments`, `lecturer_assignments`,
  `timetables` (kind, group, lecturer, clash-checked).
- **Attendance:** `class_sessions`, `session_secrets`, `attendance_records`,
  `attendance_verification_events`, `attendance_evidence`, `attendance_disputes`.
- **Acoustic layer (prepared):** `acoustic_windows`, `acoustic_submissions`.
- **Commercial:** `subscription_plans`, `institution_subscriptions`, `payments`, `usage_metrics`.
- **Messaging and audit:** `notifications`, `announcements`, `audit_logs`.

### Database migrations (run in order; `supabase/install-uniattend.sql` bundles them)
1. `…0001_core` — tenancy, academic structure, people, roles
2. `…0002_attendance` — sessions, records, verification, disputes, acoustic tables
3. `…0003_saas` — plans, subscriptions, payments, notifications, announcements, audit
4. `…0004_rls` — security policies
5. `…0005_functions` — check-in, sessions, corrections, disputes, reports, import, onboarding
6. `…0006_fix_import_safeupdate` — fix for Supabase's "UPDATE requires a WHERE clause"
7. `…0007_timetables_scale` — timetable kinds and groups, clash trigger, indexes, dashboard rollup
8. `…0008_timetable_details` — venue building, module class size, class lecturer, institution theme
9. `…0009_institution_setup` — campus outlines, timetable source per institution, institution directory
   (seeded)

---

## 7. Integrations

- **Timetable sources** (set per institution by the super admin), fetched server-side and politely (a few
  requests at a time, timeouts, one retry, size limits, a named User-Agent). Only public `https://` addresses
  are allowed; private and local addresses are refused, including after redirects.
  - *Timetable viewer (JSON API)*, e.g. `timetable.univen.ac.za`: programmes, classes, room capacities,
    lecturers and groups.
  - *Pages that link to timetable PDFs*, e.g. `tut.ac.za/timetables`: the page and its sub-pages are scanned
    for PDF links on the same site (about 950 PDFs for TUT), grouped by faculty or campus.
  - *A single PDF link.*
- **Timetable PDF export** — parsed with pdf.js from positioned text (block and CELCAT layouts).
- **OpenStreetMap** — campus outlines, building footprints and named places, used for the venue editor and
  auto-mapping. Satellite imagery from Esri.
- **Paystack** (prepared) — an Edge Function verifies the webhook signature, re-verifies the payment with
  Paystack's API, checks the amount against the plan price, and only then extends the subscription.
  Idempotent per payment reference.
- **Supabase Realtime** — live lecturer register.

---

## 8. Deployment and operation

- **Code:** GitHub `UNDEFINED-FLARE/attend`, branch `main`. Vercel deploys each push.
- **Vercel environment variables:**
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable key)
  - `NEXT_PUBLIC_SITE_URL`
- **Supabase setup:**
  1. Run the migrations, or `install-uniattend.sql` then the later patches.
  2. Add `uniattend` to *Exposed schemas*.
  3. Set the Auth Site URL and redirect URLs (`/auth/callback`).
  4. Keep **Confirm email ON** for real users.
  5. Make the first super admin with SQL.
- **Local development:** `npm install`, then `.env.local`, then `npm run dev`. The dev server writes to
  `.next-dev`, so it never conflicts with production builds in `.next`.
- **Quality checks:** `npm run test` (67 tests), `npm run typecheck`, `npm run lint`, `npm run build`.
- **Guides:** `docs/guide-admin.md`, `docs/guide-lecturer.md`, `docs/guide-student.md`. Status and roadmap
  are in `docs/02-ROADMAP.md`.

---

## 9. Known limits and next steps

- **Module titles:** timetable sources usually provide only codes, so titles are entered by admins.
- **Unmapped buildings and campuses:** buildings that aren't on OpenStreetMap need placing by hand once.
  14 of the 37 directory campuses (mostly TVET college sites) aren't on OpenStreetMap and must be placed by
  the super admin.
- **Timetable links not found:** University of Limpopo, Central University of Technology and the TVET
  colleges publish no public timetable page; their source stays *none* (PDF upload still works) until the
  institution provides a link.
- **Logos:** set by image link; file upload would need a storage bucket.
- **Not built yet:**
  - the ambient-sound check (tables ready; matcher to port);
  - PDF and Excel report exports;
  - university single sign-on;
  - offline check-in;
  - error monitoring;
  - load testing at thousands of check-ins per minute;
  - the Paystack checkout page;
  - the retention clean-up job.
- **Permission:** collecting an institution's timetable data should be agreed with that institution's
  timetable office as part of onboarding.
