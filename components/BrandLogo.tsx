"use client";

import { useState } from "react";
import { brandLogoUrl } from "@/lib/brandfetch";

export function BrandLogo({ tk }: { tk: string }) {
  const src = brandLogoUrl(tk);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = src !== null && loadedSrc === src;

  return (
    <>
      {!loaded && (
        <span className="brand-logo brand-monogram" aria-hidden="true">{tk.charAt(0)}</span>
      )}
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="brand-logo brand-cdn"
          data-loaded={loaded}
          src={src}
          alt=""
          width={256}
          height={256}
          decoding="async"
          referrerPolicy="strict-origin-when-cross-origin"
          ref={(image) => {
            if (image?.complete && image.naturalWidth > 0) setLoadedSrc(src);
          }}
          onLoad={() => setLoadedSrc(src)}
          onError={() => setLoadedSrc(null)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
