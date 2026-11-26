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

/** Flag the destination sky pan, then navigate (same pattern as auth links). */
export async function navigateWithCurtain(href: string, direction: RouteHop) {
  if (direction === "to-platform") {
    setFlag(ROUTE_FROM_LANDING_KEY);
  } else {
    resetLandingSkyDecision();
    // Same left pan as Back from signup/login.
    markComingFromAuth();
  }

  window.location.assign(href);
}
