import { useId } from "react";

export function SignalDataWarning() {
  const id = useId();
  return <>
    <button type="button" className="stock-signal-warning" aria-label="Signal data warning" aria-describedby={id}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11.1 4.5 2.8 19a1 1 0 0 0 .9 1.5h16.6a1 1 0 0 0 .9-1.5L12.9 4.5a1 1 0 0 0-1.8 0Z" />
        <path d="M12 9v4m0 3.5h.01" />
      </svg>
    </button>
    <span className="stock-signal-tooltip" role="tooltip" id={id}>
      Fundamental and/or Valuation Data is not factored into this signal
    </span>
  </>;
}
