import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession, INST_COOKIE } from "@/lib/auth";
import { lecturerSnapshot, studentSnapshot } from "@/lib/offline-snapshot";

// The signed-in person's offline copy (src/lib/offline-data.ts), fetched by the app
// while it has signal. Their own data only (RLS), never cached by anything in between.
export const dynamic = "force-dynamic";

const PRIVATE = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: PRIVATE });

export async function GET(req: Request) {
  const role = new URL(req.url).searchParams.get("role");
  if (role !== "student" && role !== "lecturer") return fail(400, "role must be student or lecturer");
  let s: Awaited<ReturnType<typeof getSession>>;
  try { s = await getSession(); } catch { return fail(503, "Can't reach the database right now."); }
  if (!s) return fail(401, "Signed out.");
  const matches = s.roles.filter((r) => r.role === role && r.institution_id);
  if (!matches.length) return fail(403, `Not a ${role}.`);
  // The same institution choice as the pages (requireRole).
  const wanted = (await cookies()).get(INST_COOKIE)?.value;
  const current = matches.find((r) => r.institution_id === wanted) ?? matches[0];
  const meta = s.user.user_metadata as { full_name?: string } | undefined;
  const ctx = {
    supabase: s.supabase, institutionId: current.institution_id as string, institutionName: current.institution_name ?? "",
    userId: s.user.id, fallbackName: meta?.full_name || s.user.email || "",
  };
  try {
    const snap = role === "student" ? await studentSnapshot(ctx) : await lecturerSnapshot(ctx);
    return NextResponse.json(snap, { headers: PRIVATE });
  } catch {
    return fail(503, "Couldn't build the offline copy.");
  }
}
