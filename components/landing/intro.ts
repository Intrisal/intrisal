/** First-visit / refresh landing wordmark + hard space-spin. */
export const LANDING_INTRO_MS = 1350;

/** Auth ↔ landing sky pan (also platform → landing). */
export const SKY_PAN_MS = 1100;

/** Set while on auth pages / leaving platform; landing peeks this to pan instead of twirling. */
export const SKY_FROM_AUTH_KEY = "intrisal-from-auth";

type LandingSkyMode = "intro" | "pan-left";

/**
 * Survives React Strict Mode remounts in the same JS context.
 * Without this, consume-once flags get cleared on the first mount and the
 * remount falls through to the twirl intro.
 */
let landingSkyDecision: LandingSkyMode | null = null;

export function markComingFromAuth() {
  try {
    sessionStorage.setItem(SKY_FROM_AUTH_KEY, "1");
  } catch {
    /* private mode / blocked storage */
  }
}

export function peekAuthReturn() {
  try {
    return sessionStorage.getItem(SKY_FROM_AUTH_KEY) === "1";
  } catch {
    return false;
  }
}

export function clearAuthReturn() {
  try {
    sessionStorage.removeItem(SKY_FROM_AUTH_KEY);
  } catch {
    /* private mode / blocked storage */
  }
}

/** Call when entering auth so the next landing visit re-decides cleanly. */
export function resetLandingSkyDecision() {
  landingSkyDecision = null;
}

/**
 * Fresh visit / refresh → intro twirl.
 * Back from signup/login/platform → pan left (opposite of the to-auth / to-platform pan right).
 * Storage is cleared immediately; the in-memory cache covers Strict Mode remounts
 * so a landing refresh still gets the twirl.
 */
export function decideLandingSky(): LandingSkyMode {
  if (landingSkyDecision) return landingSkyDecision;
  landingSkyDecision = peekAuthReturn() ? "pan-left" : "intro";
  clearAuthReturn();
  return landingSkyDecision;
}
