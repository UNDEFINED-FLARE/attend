"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

const uuid = z.string().uuid();

/** Turn the Bluetooth room signal on or off for one session (database update 0037). */
export async function setSessionBluetooth(_: unknown, form: FormData): Promise<{ error?: string; ok?: string } | undefined> {
  const p = z.object({ session: uuid, on: z.enum(["1", "0"]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "That request was not valid." };
  const supabase = await supabaseServer();
  const { error } = await supabase.rpc("set_session_bluetooth", { p_session: p.data.session, p_on: p.data.on === "1" });
  if (error) return { error: error.message };
  revalidatePath(`/lecturer/sessions/${p.data.session}`);
  return { ok: p.data.on === "1" ? "Bluetooth is on for this session." : "Bluetooth is off for this session." };
}

export type BleToken = { open: boolean; bluetooth?: boolean; id?: string; refresh_in_ms?: number; error?: string };

/** Polled by the lecturer's phone while it broadcasts. Signed in the database; the key never leaves it. */
export async function bleToken(session: string): Promise<BleToken> {
  if (!uuid.safeParse(session).success) return { open: false };
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("session_ble_token", { p_session: session });
  if (error) return { open: false, error: error.message };
  return data as BleToken;
}
