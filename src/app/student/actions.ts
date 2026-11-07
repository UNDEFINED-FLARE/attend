"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

export type Verdict = {
  outcome: "accepted" | "review" | "rejected" | "duplicate";
  status: string | null;
  score: number | null;
  reasons: string[];
  module_code?: string;
  session_title?: string;
};

const Sample = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().positive().max(100_000) });
const Input = z.object({
  session: z.string().uuid().nullable(),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6}$/).nullable(),
  token: z.string().max(64).nullable(),
  gps: z.object({ samples: z.array(Sample).max(20) }).nullable(),
  device: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
});

/** Sends raw evidence. The database decides the status; nothing here can set it. */
export async function checkIn(raw: z.input<typeof Input>): Promise<Verdict | { error: string }> {
  const p = Input.safeParse(raw);
  if (!p.success) return { error: "That code does not look right. Check it and try again." };
  if (!p.data.session && !p.data.code) return { error: "Scan the QR code or type the six-character code." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("check_in", {
    p_session: p.data.session, p_code: p.data.code, p_token: p.data.token,
    p_gps: p.data.gps, p_device_hash: p.data.device,
  });
  if (error) return { error: error.message };
  revalidatePath("/student");
  return data as Verdict;
}

export async function dispute(_: unknown, form: FormData) {
  const p = z.object({ record: z.string().uuid(), reason: z.string().trim().min(10, "Explain in at least 10 characters.").max(2000) })
    .safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("submit_dispute", { p_record: p.data.record, p_reason: p.data.reason });
  if (error) return { error: error.message };
  revalidatePath("/student/history");
  return { ok: "Dispute submitted. Your lecturer has been notified." };
}
