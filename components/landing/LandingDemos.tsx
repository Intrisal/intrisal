"use client";

const TICKERS = ["NVDA", "MSFT", "META", "AMZN"] as const;

/** Thesis demos of the product — landing-only mock UI with fire accents. */
export function LandingDemos() {
  return (
    <section className="landing-demos" aria-label="How Intrisal feels">
      <header className="landing-demos-head">
        <p className="landing-kicker">Inside the platform</p>
        <h2>Clear signals. Calm space. Fire when it matters.</h2>
        <p>Same night-sky Intrisal you trade in — demos of the judgment layer, not more chart noise.</p>
      </header>

      <div className="landing-demo-grid">
        <article className="landing-demo landing-demo-signal">
          <div className="landing-demo-glow" aria-hidden="true" />
          <p className="landing-demo-label">Buy signal</p>
          <h3>Worth buying — and why</h3>
          <div className="landing-sparkline" aria-hidden="true">
            <svg viewBox="0 0 280 110" preserveAspectRatio="none">
              <path className="landing-sma-long" d="M0 78 C40 74, 70 70, 110 66 S180 58, 280 52" />
              <path className="landing-sma-short" d="M0 70 C50 68, 90 54, 140 48 S210 40, 280 36" />
              <path className="landing-price" d="M0 82 C35 76, 60 62, 100 58 S160 34, 210 30 S250 28, 280 22" />
              <circle className="landing-price-tip" cx="280" cy="22" r="4.5" />
            </svg>
            <div className="landing-fire-sweep" />
          </div>
          <ul className="landing-demo-points">
            <li>
              <span className="landing-dot landing-dot-fire" /> Price above SMA trend
            </li>
            <li>
              <span className="landing-dot" /> Business quality holding up
            </li>
          </ul>
          <p className="landing-verdict landing-verdict-fire">Buy · trend + performance aligned</p>
        </article>

        <article className="landing-demo landing-demo-weather">
          <div className="landing-demo-glow" aria-hidden="true" />
          <p className="landing-demo-label">Weather-app ease</p>
          <h3>One calm answer</h3>
          <div className="landing-weather" aria-hidden="true">
            <div className="landing-weather-orb">
              <span>Buy</span>
              <i />
            </div>
            <div className="landing-weather-copy">
              <strong>NVDA</strong>
              <span>Clear skies on trend. Fundamentals warm.</span>
            </div>
          </div>
          <p className="landing-demo-foot">Beginner to advanced — nobody left guessing.</p>
        </article>

        <article className="landing-demo landing-demo-dock">
          <div className="landing-demo-glow" aria-hidden="true" />
          <p className="landing-demo-label">Your watchlist</p>
          <h3>Recent names, ready</h3>
          <div className="landing-dock" aria-hidden="true">
            {TICKERS.map((tk, index) => (
              <div key={tk} className="landing-dock-coin" style={{ ["--d" as string]: index }}>
                <span>{tk.slice(0, 1)}</span>
              </div>
            ))}
          </div>
          <p className="landing-demo-foot">Open a name. See the signal. Move on.</p>
        </article>
      </div>
    </section>
  );
}
