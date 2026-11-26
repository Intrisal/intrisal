"use client";

import { useLayoutEffect } from "react";
import { playArrivalCurtain } from "@/lib/routeTransition";

/** Runs the matching uncover curtain when arriving from the other surface. */
export function RouteArrive({ kind }: { kind: "platform" | "landing" }) {
  useLayoutEffect(() => {
    playArrivalCurtain(kind);
  }, [kind]);
  return null;
}
