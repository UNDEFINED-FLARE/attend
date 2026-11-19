"use client";
import { useEffect } from "react";
import { forgetOfflineData } from "@/lib/offline-data";

/**
 * On the sign-in pages (where signing out lands): the offline copy and kept pages
 * belong to whoever was signed in before, so they go. Draws nothing.
 */
export function ForgetOffline() {
  useEffect(() => { forgetOfflineData(); }, []);
  return null;
}
