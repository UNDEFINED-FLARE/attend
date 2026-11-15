"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { kickPush } from "@/lib/push";

type S = { error?: string; ok?: string };

const Input = z.object({
  records: z.array(z.string().uuid("That check-in could not be found. Reload the page.")).min(1, "Choose at least one check-in.").max(500, "Choose at most 500 at a time."),
  status: z.enum(["present", "late", "absent", "excused"]),
  note: z.string().trim().max(500),
});

/** Decide check-ins under review. The database checks the reviewer may decide each one. */
export async function decideReview(records: string[], status: string, note: string): Promise<S> {
  const p = Input.safeParse({ records, status, note });
  if (!p.success) return { error: p.error.issues[0].message };
  if ((p.data.status === "absent" || p.data.status === "excused") && p.data.note.length < 3) {
    return { error: `Give a reason for recording ${p.data.records.length === 1 ? "this student" : "these students"} ${p.data.status}.` };
  }
  const s = await getSession();
  if (!s) return { error: "Sign in again." };
  const { data, error } = await s.supabase.rpc("decide_review", { p_records: p.data.records, p_status: p.data.status, p_note: p.data.note || null });
  if (error) {
    if (error.code === "PGRST202") return { error: "Reviews need the latest database update (migration 0029)." };
    return { error: error.code === "42501" ? "You can only decide check-ins for modules you teach." : error.message };
  }
  after(kickPush); // students are told the outcome
  revalidatePath("/lecturer/disputes");
  revalidatePath("/admin/review");
  const n = data as number;
  const skipped = p.data.records.length - n;
  return { ok: `${n} recorded as ${p.data.status}.${skipped ? ` ${skipped} had already been decided and were left as they were.` : ""} Students have been told.` };
}
