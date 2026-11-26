"use client";

import { useEffect, useState } from "react";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

/** Shared signed-in user lookup for landing + platform chrome. */
export function useSessionUser() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: { user?: SessionUser | null }) => {
        if (!cancelled) setUser(body.user ?? null);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { user, loading };
}

export async function signOutAndReload() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch {
    /* still clear local view */
  }
  window.location.assign("/");
}
