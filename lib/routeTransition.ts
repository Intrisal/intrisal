/**
 * Soft curtain between landing ↔ platform so the cut feels intentional.
 */

import { markComingFromAuth, resetLandingSkyDecision } from "@/components/landing/intro";

export const ROUTE_FROM_LANDING_KEY = "intrisal-from-landing";
export const ROUTE_FROM_PLATFORM_KEY = "intrisal-from-platform";
export const CURTAIN_MS = 520;

export type RouteHop = "to-platform" | "to-landing";

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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

function playCurtain(direction: RouteHop): Promise<void> {
  return new Promise((resolve) => {
    const existing = document.querySelector(".route-curtain");
    existing?.remove();

    const el = document.createElement("div");
    el.className = `route-curtain route-curtain--${direction}`;
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
    void el.offsetWidth;
    el.classList.add("is-covering");

    window.setTimeout(() => resolve(), CURTAIN_MS);
  });
}

/** Exit animation, then navigate. Destination plays the matching uncover. */
export async function navigateWithCurtain(href: string, direction: RouteHop) {
  if (direction === "to-platform") {
    setFlag(ROUTE_FROM_LANDING_KEY);
  } else {
    resetLandingSkyDecision();
    markComingFromAuth();
    setFlag(ROUTE_FROM_PLATFORM_KEY);
  }

  if (reducedMotion()) {
    window.location.assign(href);
    return;
  }

  await playCurtain(direction);
  window.location.assign(href);
}

/**
 * On arrival, cover briefly then uncover so the hop feels continuous.
 * Returns true when an arrival curtain ran.
 */
export function playArrivalCurtain(kind: "platform" | "landing"): boolean {
  if (reducedMotion()) return false;

  const flag =
    kind === "platform"
      ? consumeFlag(ROUTE_FROM_LANDING_KEY)
      : consumeFlag(ROUTE_FROM_PLATFORM_KEY);
  if (!flag) return false;

  const direction: RouteHop = kind === "platform" ? "to-platform" : "to-landing";
  const el = document.createElement("div");
  el.className = `route-curtain route-curtain--${direction} is-covering is-arrive`;
  el.setAttribute("aria-hidden", "true");
  document.body.appendChild(el);
  void el.offsetWidth;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      el.classList.remove("is-covering", "is-arrive");
      el.classList.add("is-clearing");
      window.setTimeout(() => el.remove(), CURTAIN_MS + 40);
    });
  });
  return true;
}
