"use client";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { LatLng } from "@/lib/campuses";

export type Venueish = {
  id?: string;
  name: string;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  polygon: LatLng[] | null;
};

export const BRAND = "#0b2545";
export const OK = "#157f3d";
export const WARN = "#a15c00";
export const INFO = "#1d4ed8";

/**
 * Creates a Leaflet map in `ref` once the library has loaded (it touches
 * `window`, so it is imported on the client only). Street and satellite base
 * layers; satellite is what lets an admin see which roof is which hall.
 */
export function useLeaflet(ref: RefObject<HTMLDivElement | null>, center: LatLng, zoom: number, opts?: { scrollWheelZoom?: boolean }) {
  const [state, setState] = useState<{ map: Leaflet.Map; L: typeof Leaflet } | null>(null);
  const init = useRef({ center, zoom, opts });

  useEffect(() => {
    let map: Leaflet.Map | null = null;
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (cancelled || !ref.current) return;
      map = L.map(ref.current, { scrollWheelZoom: init.current.opts?.scrollWheelZoom ?? false, zoomControl: true })
        .setView(init.current.center, init.current.zoom);
      const street = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      });
      const satellite = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics",
      });
      satellite.addTo(map);
      L.control.layers({ Satellite: satellite, Street: street }, undefined, { position: "topright" }).addTo(map);
      L.control.scale({ imperial: false }).addTo(map);
      setState({ map, L });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [ref]);

  return state;
}

/** Draws a venue as its outline (preferred) or its radius circle. */
export function drawVenue(L: typeof Leaflet, group: Leaflet.LayerGroup, v: Venueish, color: string, opts?: { label?: boolean; weight?: number; onClick?: () => void }) {
  let layer: Leaflet.Path | null = null;
  if (v.polygon && v.polygon.length >= 3) layer = L.polygon(v.polygon, { color, weight: opts?.weight ?? 2, fillOpacity: 0.2 });
  else if (v.lat != null && v.lng != null) layer = L.circle([v.lat, v.lng], { radius: v.radius_m ?? 50, color, weight: opts?.weight ?? 2, fillOpacity: 0.15 });
  if (!layer) return null;
  if (opts?.label !== false) layer.bindTooltip(v.name, { direction: "top", sticky: true });
  if (opts?.onClick) layer.on("click", (e) => { L.DomEvent.stopPropagation(e); opts.onClick!(); });
  layer.addTo(group);
  return layer;
}
