import { NextResponse } from "next/server";
import { z } from "zod";
import { distanceM, type LatLng } from "@/lib/geo";
import type { RouteResult, RouteStep } from "@/lib/route";
import { supabaseServer } from "@/lib/supabase/server";

// Walking directions for "Find my class".
// The request goes through our server so the OpenRouteService key stays secret
// and ORS never sees who is asking: only two coordinates are sent, no name,
// account or IP of the student. Without ORS_API_KEY (or if ORS is down) we
// fall back to a straight line with a compass direction.
const Point = z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]);
const Body = z.object({ from: Point, to: Point });
const WALK_MPS = 1.3; // average walking speed

type OrsStep = { instruction?: string; distance?: number; duration?: number; way_points?: [number, number] };
type OrsFeature = {
  geometry?: { coordinates?: [number, number][] };
  properties?: { summary?: { distance?: number; duration?: number }; segments?: { steps?: OrsStep[] }[] };
};

export async function POST(request: Request) {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  const from = parsed.data.from as LatLng;
  const to = parsed.data.to as LatLng;
  const crow = distanceM(from, to);
  if (crow > 25_000) return NextResponse.json({ error: "That destination is too far away to walk." }, { status: 400 });

  const direct: RouteResult = { mode: "direct", line: [from, to], steps: [], distance: crow, duration: crow / WALK_MPS };
  const key = process.env.ORS_API_KEY;
  if (!key) return NextResponse.json(direct);

  try {
    const res = await fetch("https://api.openrouteservice.org/v2/directions/foot-walking/geojson", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json", Accept: "application/geo+json, application/json" },
      // ORS (GeoJSON) wants [lng, lat]
      body: JSON.stringify({ coordinates: [[from[1], from[0]], [to[1], to[0]]], instructions: true, language: "en", units: "m" }),
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`OpenRouteService answered ${res.status}`);
    const feature = ((await res.json()) as { features?: OrsFeature[] }).features?.[0];
    const line = (feature?.geometry?.coordinates ?? []).map(([lng, lat]) => [lat, lng] as LatLng);
    if (line.length < 2) throw new Error("empty route");
    const steps: RouteStep[] = (feature?.properties?.segments ?? []).flatMap((s) => s.steps ?? []).map((s) => ({
      instruction: String(s.instruction ?? ""),
      distance: Number(s.distance ?? 0),
      duration: Number(s.duration ?? 0),
      from: Number(s.way_points?.[0] ?? 0),
      to: Number(s.way_points?.[1] ?? 0),
    }));
    const summary = feature?.properties?.summary;
    const result: RouteResult = {
      mode: "walking", line, steps,
      distance: Number(summary?.distance ?? crow),
      duration: Number(summary?.duration ?? crow / WALK_MPS),
    };
    return NextResponse.json(result);
  } catch (e) {
    console.warn("walking route unavailable, using direct line:", (e as Error).message);
    return NextResponse.json({ ...direct, notice: "Walking directions are unavailable right now, so this shows the direct line." });
  }
}
