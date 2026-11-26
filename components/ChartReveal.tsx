import { useId, useState, type ReactNode } from "react";

type ChartRevealProps = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  children: ReactNode;
};

export function ChartReveal({ left, right, top, bottom, children }: ChartRevealProps) {
  const clipId = useId();
  const [revealed, setRevealed] = useState(false);
  const padding = 8;

  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect className={revealed ? undefined : "chart-reveal-window"} onAnimationEnd={() => setRevealed(true)}
            x={left - padding} y={top - padding}
            width={right - left + 2 * padding} height={bottom - top + 2 * padding} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>{children}</g>
    </>
  );
}
