import "server-only";
import { createClient } from "@supabase/supabase-js";
import { DB_SCHEMA, env } from "@/lib/env";
import { dispatchSecret } from "@/lib/push";
import { chunkRoster, courseCode, moodlePeople, parseOptions, type Roster } from "./roster";
import { decryptSecret } from "./secrets";
import { fetchRosterFeed, moodleCourses, moodleEnrolled } from "./sources";

// The sync worker. The database decides what is due and hands over one connection
// at a time (integration_claim), with its token, only to the holder of the dispatch
// secret. A large Moodle is read a few courses at a time: when the time budget runs
// out the place is saved and the next call carries on, so it fits a serverless function.

type Job = { id: string; institution_id: string; kind: "moodle" | "feed"; base_url: string; options: unknown;
  token: string | null; run_id: string; cursor: number; module_codes: string[] | null };

const PEOPLE_PER_CALL = 1500;

export async function runDueIntegrations(budgetMs = 40_000): Promise<{ ran: number }> {
  const secret = dispatchSecret();
  if (!secret) return { ran: 0 };
  const db = createClient(env.url, env.anonKey, { db: { schema: DB_SCHEMA }, auth: { persistSession: false, autoRefreshToken: false } });
  const started = Date.now();
  const timeLeft = () => budgetMs - (Date.now() - started);
  let ran = 0;

  while (timeLeft() > 8_000 && ran < 5) {
    const { data, error } = await db.rpc("integration_claim", { p_secret: secret });
    // Before migration 0024 the function doesn't exist: nothing to do.
    if (error || !data) break;
    const job = data as Job;
    ran++;
    const apply = async (roster: Roster, cursor: number) => {
      const { error: e } = await db.rpc("integration_apply", { p_secret: secret, p_run: job.run_id, p_payload: roster, p_cursor: cursor });
      if (e) throw new Error(e.message);
    };
    const done = (status: "ok" | "failed" | "later", message: string | null, complete: boolean) =>
      db.rpc("integration_done", { p_secret: secret, p_run: job.run_id, p_status: status, p_error: message, p_complete: complete });

    try {
      const o = parseOptions(job.options);
      // Stored encrypted; decrypted only here, in memory, for this run.
      job.token = decryptSecret(job.token);
      if (job.kind === "feed") {
        const roster = await fetchRosterFeed(job.base_url, job.token);
        for (const piece of chunkRoster(roster, PEOPLE_PER_CALL)) await apply(piece, 0);
        await done("ok", null, true);
        continue;
      }

      if (!job.token) throw new Error("This connection has no token. Edit it and paste the Moodle token.");
      const known = new Set((job.module_codes ?? []).map((c) => c.toUpperCase()));
      const courses = await moodleCourses(job.base_url, job.token);
      let i = job.cursor, pending: Roster = { modules: [], people: [] }, outOfTime = false;
      for (; i < courses.length; i++) {
        if (timeLeft() < 6_000) { outOfTime = true; break; }
        const code = courseCode(courses[i], o);
        if (!code || (!o.create_modules && !known.has(code))) continue;   // not a module UniAttend tracks
        const users = await moodleEnrolled(job.base_url, job.token, courses[i].id);
        pending.modules.push({ code, title: courses[i].fullname || code });
        pending.people.push(...moodlePeople(code, users, o));
        if (pending.people.length >= PEOPLE_PER_CALL) { await apply(pending, i + 1); pending = { modules: [], people: [] }; }
      }
      if (pending.modules.length) await apply(pending, i);
      else if (outOfTime) await apply({ modules: [], people: [] }, i);     // just save the place
      if (outOfTime) await done("later", null, false);
      else await done("ok", null, true);
    } catch (e) {
      const message = e instanceof Error ? e.message : "The sync could not finish.";
      await done("failed", message.slice(0, 400), false);
    }
  }
  return { ran };
}

/** Run now after an administrator's action; errors never reach the user. */
export async function kickIntegrations() {
  try { await runDueIntegrations(); } catch (e) { console.error("integration sync failed", e); }
}
