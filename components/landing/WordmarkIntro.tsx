"use client";

const LETTERS = ["I", "n", "t", "r", "i", "s", "a", "l"] as const;

/** Full-screen Intrisal wordmark over the shared space sky. */
export function WordmarkIntro() {
  return (
    <div className="landing-intro" aria-hidden="true">
      <div className="landing-intro-bloom" />
      <h1 className="landing-wordmark">
        {LETTERS.map((letter, index) => (
          <span key={`${letter}-${index}`} style={{ ["--i" as string]: index }}>
            {letter}
          </span>
        ))}
      </h1>
    </div>
  );
}
