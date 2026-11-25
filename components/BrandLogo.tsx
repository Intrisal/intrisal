"use client";

import { useState } from "react";
import { brandLogoUrl } from "@/lib/brandfetch";

export function BrandLogo({ tk }: { tk: string }) {
  const fillSrc = brandLogoUrl(tk, 256, "icon", "lettermark");
  const markSrc = brandLogoUrl(tk, 256, "symbol", "404");
  const [fillFailed, setFillFailed] = useState(false);
  const [markFailed, setMarkFailed] = useState(false);

  if (!fillSrc || fillFailed) {
    return (
      <span className="brand-logo brand-monogram" aria-hidden="true">
        {tk.charAt(0)}
      </span>
    );
  }

  const showMark = Boolean(markSrc) && !markFailed;

  return (
    <>
      {/* Fill: brand icon background covers the whole coin. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={"brand-logo brand-cdn brand-cdn-fill" + (showMark ? "" : " brand-cdn-fill-solo")}
        src={fillSrc}
        alt=""
        width={256}
        height={256}
        decoding="async"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onError={() => setFillFailed(true)}
        aria-hidden="true"
      />
      {/* Mark: inset symbol so the glyph (e.g. Netflix N) stays clear of the rim. */}
      {showMark ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="brand-logo brand-cdn brand-cdn-mark"
          src={markSrc!}
          alt=""
          width={256}
          height={256}
          decoding="async"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onError={() => setMarkFailed(true)}
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}
