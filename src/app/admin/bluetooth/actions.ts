"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";

type S = { error?: string; ok?: string } | undefined;

/** The institution's Bluetooth switch and the faintest signal that counts (database update 0037). */
export async function saveBluetoothPolicy(_: S, f: FormData): Promise<S> {
  const p = z.object({
    enabled: z.boolean(),
    min_rssi: z.coerce.number().int().min(-110).max(-40),
  }).safeParse({ enabled: f.get("enabled") === "on", min_rssi: f.get("min_rssi") });
  if (!p.success) return { error: "Choose a signal strength between -110 and -40 dBm." };
  const { supabase, institutionId } = await requireRole("institution_admin");
  const { error } = await supabase.rpc("set_bluetooth_policy", { p_inst: institutionId, p_enabled: p.data.enabled, p_min_rssi: p.data.min_rssi });
  if (error) return { error: error.code === "PGRST202" ? "Bluetooth needs the latest database update (migration 0037)." : error.message };
  revalidatePath("/admin/bluetooth");
  return { ok: p.data.enabled ? "Bluetooth check-in is on. Lecturers can now turn it on per session." : "Bluetooth check-in is off." };
}
