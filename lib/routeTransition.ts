/**
 * Landing ↔ platform hops reuse the auth sky pans (right to platform, left back).
 */

import { markComingFromAuth, resetLandingSkyDecision } from "@/components/landing/intro";

export const ROUTE_FROM_LANDING_KEY = "intrisal-from-landing";

export type RouteHop = "to-platform" | "to-landing";

function setFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    /* private mode */
  }
}

export function consumeFlag(key: string) {
  try {
    if (sessionStorage.getItem(key) === "1") {
      sessionStorage.removeItem(key);
      return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

type PlatformArrival = "pan" | "direct";

/** Survives Strict Mode remount so Open platform doesn't lose the pan flag. */
let platformArrivalDecision: PlatformArrival | null = null;

/**
 * One-shot: Open platform → pan (same as auth). Refresh / in-app Home → direct.
 * Safe to call from useLayoutEffect; cached for remounts in the same page load.
 */
export function decidePlatformArrival(): PlatformArrival {
  if (platformArrivalDecision) return platformArrivalDecision;
  if (typeof window === "undefined") return "direct";
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  platformArrivalDecision = !reduced && consumeFlag(ROUTE_FROM_LANDING_KEY) ? "pan" : "direct";
  return platformArrivalDecision;
}

/** Flag the destination sky pan, then navigate (same pattern as auth links). */
export async function navigateWithCurtain(href: string, direction: RouteHop) {
  if (direction === "to-platform") {
    platformArrivalDecision = null;
    setFlag(ROUTE_FROM_LANDING_KEY);
  } else {
    resetLandingSkyDecision();
    // Same left pan as Back from signup/login.
    markComingFromAuth();
  }

  window.location.assign(href);
}
