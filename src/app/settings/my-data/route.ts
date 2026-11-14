import { supabaseServer } from "@/lib/supabase/server";

// "Download my data": everything UniAttend holds about the signed-in person (POPIA s 23).
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  const { data, error } = await supabase.rpc("my_personal_data");
  if (error) {
    return new Response(error.code === "PGRST202" ? "This needs the latest database update (migration 0023)." : "Could not prepare your data. Try again.", { status: 503 });
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="uniattend-my-data-${day}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
