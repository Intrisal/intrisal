"use client";

/** One slow dot that streaks in from the side and continues into the landing. */
const STAR = {
  left: "-4%",
  top: "16%",
  // Both offsets are in vw, so the path angle is the same on every screen shape.
  dx: "118vw",
  dy: "26vw",
  // atan2(26, 118) rounded — keep fixed so SSR/client styles match.
  angle: "12.43deg",
  dur: "4.2s",
  delay: "0.4s",
} as const;

/** Shooting dot sits above the sky so it outlives the intro lift. */
export function LandingShooters() {
  return (
    <div className="landing-shooters" aria-hidden="true">
      <i
        style={{
          ["--left" as string]: STAR.left,
          ["--top" as string]: STAR.top,
          ["--dx" as string]: STAR.dx,
          ["--dy" as string]: STAR.dy,
          ["--angle" as string]: STAR.angle,
          ["--dur" as string]: STAR.dur,
          ["--delay" as string]: STAR.delay,
        }}
      />
    </div>
  );
}
