"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import "leaflet/dist/leaflet.css";

export type L = typeof Leaflet;
export type LMap = Leaflet.Map;

/**
 * Creates a Leaflet map inside `ref` once, in the browser only (Leaflet needs
 * `window`), with OpenStreetMap tiles. Returns null for L/map until loaded.
 * OSM's tile policy requires the attribution below to stay visible.
 */
export function useLeafletMap(center: [number, number], zoom = 16) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ L: L; map: LMap } | null>(null);
  const initial = useRef({ center, zoom });

  useEffect(() => {
    let map: LMap | undefined;
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = ((mod as unknown as { default?: L }).default ?? mod) as L;
      if (cancelled || !ref.current) return;
      map = L.map(ref.current).setView(initial.current.center, initial.current.zoom);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      setState({ L, map });
    });
    return () => { cancelled = true; map?.remove(); };
  }, []);

  return { ref, L: state?.L ?? null, map: state?.map ?? null };
}

/** Campus/venue rings are stored as [[lat,lng],...]; Leaflet takes the same order. */
export type Ring = [number, number][];
export const isRing = (v: unknown): v is Ring =>
  Array.isArray(v) && v.length >= 3 && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number"));
