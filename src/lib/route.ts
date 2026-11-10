import type { LatLng } from "@/lib/geo";

/** What /api/route returns. `from`/`to` are indexes into `line` (OpenRouteService way_points). */
export type RouteStep = { instruction: string; distance: number; duration: number; from: number; to: number };
export type RouteResult = {
  mode: "walking" | "direct";
  line: LatLng[];
  steps: RouteStep[];
  distance: number; // metres
  duration: number; // seconds
  notice?: string;
};
