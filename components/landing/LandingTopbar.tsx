"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfileIcon } from "@/components/Icons";

/**
 * Landing top bar: the profile control mirrors the platform person menu for page
 * switching, and a way into the platform appears once the hero has scrolled away.
 */
export function LandingTopbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDoc(ev: MouseEvent) {
      const target = ev.target instanceof Element ? ev.target : null;
      if (target?.closest(".landing-topbar-menu")) return;
      setOpen(false);
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") setOpen(false);
    }
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The hero and the closing band carry their own call to action, so the bar only repeats it in between.
  useEffect(() => {
    let frame = 0;
    function measure() {
      frame = 0;
      const view = window.innerHeight;
      const pastHero = window.scrollY > view * 0.6;
      const atClose = window.scrollY + view > document.documentElement.scrollHeight - view * 0.45;
      setScrolled(pastHero && !atClose);
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(measure);
    }
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <header className={"landing-topbar" + (scrolled ? " is-scrolled" : "")}>
      <div className="landing-topbar-menu">
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
            <Link className="landing-profile-link" href="/login" role="menuitem" onClick={() => setOpen(false)}>
              Sign in
            </Link>
            <Link className="landing-profile-link" href="/signup" role="menuitem" onClick={() => setOpen(false)}>
              Create account
            </Link>
          </div>
        ) : null}
      </div>
      <Link
        className="landing-topbar-cta"
        href="/login"
        tabIndex={scrolled ? undefined : -1}
        aria-hidden={scrolled ? undefined : true}
      >
        Sign in
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 8h10M9 4l4 4-4 4" />
        </svg>
      </Link>
    </header>
  );
}
