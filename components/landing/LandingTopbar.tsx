"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfileIcon } from "@/components/Icons";

/** Landing profile control — mirrors the platform person menu for page switching. */
export function LandingTopbar() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target?.closest(".landing-topbar")) return;
      setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  return (
    <div className="landing-topbar">
      <button
        type="button"
        className="landing-profile-btn"
        aria-label="Profile"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <ProfileIcon />
      </button>
      {open ? (
        <div className="landing-profile-menu" role="menu" aria-label="Profile menu" onClick={(ev) => ev.stopPropagation()}>
          <p className="landing-profile-kicker">Pages</p>
          <Link className="landing-profile-link" href="/" role="menuitem" aria-current="page" onClick={() => setOpen(false)}>
            Landing page
          </Link>
          <Link className="landing-profile-link" href="/home" role="menuitem" onClick={() => setOpen(false)}>
            Platform
          </Link>
        </div>
      ) : null}
    </div>
  );
}
