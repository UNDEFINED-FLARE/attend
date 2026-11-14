// The systems a university might connect, and how. Honest by design: a method is
// listed as available only when UniAttend can actually use it today. A vendor's own
// API that needs the institution's documentation, licence and approval is shown as
// such, never as connected or ready. Pure data; no network.

export type MethodKey = "moodle" | "feed" | "api" | "upload";

/** How data can come in. Each available method maps to a working part of UniAttend. */
export const METHODS: Record<MethodKey, { label: string; about: string; kind?: "moodle" | "feed" | "api" }> = {
  moodle: { label: "Moodle web services", about: "UniAttend signs in to your Moodle with a read-only token and reads courses and participants on a schedule.", kind: "moodle" },
  feed: { label: "Scheduled file link", about: "Your system publishes a CSV or JSON export at an https address; UniAttend reads it every day or hour.", kind: "feed" },
  api: { label: "Your system sends it (API)", about: "Your system or middleware posts the roster to UniAttend whenever it changes, with a key you create here.", kind: "api" },
  upload: { label: "File upload", about: "An administrator uploads a CSV, Excel or JSON export, matches the columns and confirms after a preview." },
};

export type ProviderKey = "moodle" | "its" | "celcat" | "banner" | "peoplesoft" | "blackboard" | "entra" | "custom" | "files";
export const PROVIDER_KEYS = ["moodle", "its", "celcat", "banner", "peoplesoft", "blackboard", "entra", "custom", "files"] as const;

export type Provider = {
  key: ProviderKey;
  name: string;
  vendor?: string;
  category: "Student information system" | "Learning management system" | "Timetabling" | "Identity and sign-in" | "Your own system" | "Files";
  about: string;
  data: string[];
  /** Methods that work now, best first. */
  methods: MethodKey[];
  /** What is not built, in plain words; shown on the card. */
  notYet?: string;
  /** What the institution must obtain before a direct connection is possible. */
  needs?: string;
  docs?: string;
};

export const PROVIDERS: Provider[] = [
  { key: "moodle", name: "Moodle", category: "Learning management system",
    about: "Read courses and the students and lecturers enrolled in them from your Moodle site.",
    data: ["Modules (courses)", "Students", "Lecturers", "Enrolments", "Who teaches what"], methods: ["moodle", "upload"],
    needs: "Moodle course membership is not always official registration. Use it as the source only if your institution approves that.",
    docs: "https://docs.moodle.org/en/Using_web_services" },
  { key: "its", name: "ITS Integrator", vendor: "Adapt IT", category: "Student information system",
    about: "Keep UniAttend in step with student registrations, modules and enrolments from your ITS environment.",
    data: ["Students", "Registration status", "Modules", "Enrolments", "Academic structure", "Academic periods"], methods: ["feed", "api", "upload"],
    notYet: "A direct ITS Integrator API connection is not built: ITS installations differ, and it needs your institution's documentation.",
    needs: "Your ICT department's approval, and either a scheduled export from ITS or Adapt IT's integration documentation for your version." },
  { key: "celcat", name: "CELCAT", category: "Timetabling",
    about: "Bring in venues now; scheduled lectures, groups, changes and cancellations once timetable sync is built.",
    data: ["Venues", "Lecturers"], methods: ["upload", "feed"],
    notYet: "Timetable events (dated lectures, changes, cancellations) can't be synchronised yet. That is the next stage of work.",
    needs: "An export or API access approved by your timetabling office." },
  { key: "banner", name: "Ellucian Banner", category: "Student information system",
    about: "Students, programmes, courses, enrolments and terms from your Banner environment.",
    data: ["Students", "Programmes", "Modules", "Enrolments", "Academic periods"], methods: ["feed", "api", "upload"],
    notYet: "A direct Banner API connection is not built; it depends on your licensed Banner APIs.",
    needs: "Your institution's Banner API documentation and credentials, or a scheduled export." },
  { key: "peoplesoft", name: "PeopleSoft Campus Solutions", vendor: "Oracle", category: "Student information system",
    about: "Student records, programmes, course catalogue, enrolments and terms.",
    data: ["Students", "Programmes", "Modules", "Enrolments", "Academic periods"], methods: ["feed", "api", "upload"],
    notYet: "A direct PeopleSoft connection is not built; it depends on your integration broker setup.",
    needs: "A scheduled export, or your institution's integration documentation." },
  { key: "blackboard", name: "Blackboard", category: "Learning management system",
    about: "Courses and course memberships.",
    data: ["Modules (courses)", "Students", "Lecturers", "Enrolments"], methods: ["upload", "feed"],
    notYet: "A direct Blackboard REST connection is not built yet.",
    needs: "A registered Blackboard REST application for your institution, or an export." },
  { key: "entra", name: "Microsoft Entra ID", vendor: "Microsoft", category: "Identity and sign-in",
    about: "Let staff and students sign in with their university Microsoft account.",
    data: ["Sign-in"], methods: [],
    notYet: "Not available yet. It is set up in the sign-in service (Supabase Auth), not as a data sync, and it never enrols anyone in modules.",
    needs: "An app registration in your Entra ID tenant, approved by your ICT department." },
  { key: "custom", name: "Your own system", category: "Your own system",
    about: "An in-house student system or middleware: push the roster to UniAttend, or publish an export it reads.",
    data: ["Students", "Lecturers", "Modules", "Enrolments", "Who teaches what"], methods: ["api", "feed", "upload"],
    docs: "/admin/connections" },
  { key: "files", name: "CSV, Excel and JSON files", category: "Files",
    about: "Any export from any system. Match the columns once, preview every change, then confirm.",
    data: ["Students", "Lecturers", "Modules", "Enrolments", "Who teaches what", "Faculties", "Departments", "Programmes", "Academic periods", "Venues"],
    methods: ["upload"] },
];

export const providerDef = (key: string | null | undefined) => PROVIDERS.find((p) => p.key === key);

/** Which provider a connection belongs to: the one chosen in the wizard, or the obvious one for its kind. */
export function providerOf(kind: string, options: Record<string, unknown> | null | undefined): Provider | undefined {
  const chosen = providerDef(typeof options?.provider === "string" ? options.provider : null);
  return chosen ?? (kind === "moodle" ? providerDef("moodle") : providerDef("custom"));
}

/** Counts from either kind of run (roster connections, or the engine), in one shape. */
export function runCounts(s: Record<string, unknown> | null | undefined) {
  const n = (k: string) => Number(s?.[k] ?? 0) || 0;
  const engine = s != null && "received" in s;
  return engine
    ? { received: n("received"), inserted: n("inserted"), updated: n("updated"), rejected: n("rejected") }
    : { received: n("people"), inserted: n("students_added") + n("lecturers_added") + n("enrolments_added") + n("assignments_added") + n("modules_created"),
        updated: n("students_updated") + n("lecturers_updated"), rejected: n("skipped") };
}

/** A connection that should have synced by now and hasn't: twice its schedule, plus an hour. */
export function isStale(schedule: string, status: string, lastSuccess: string | null, createdAt: string, now = Date.now()): boolean {
  if (status !== "active" || schedule === "manual") return false;
  const every = schedule === "hourly" ? 3600_000 : 86400_000;
  return now - Date.parse(lastSuccess ?? createdAt) > every * 2 + 3600_000;
}
