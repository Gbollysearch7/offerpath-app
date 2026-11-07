"use client";

import { useEffect } from "react";
import { LIVE_REGION_ID } from "./a11y";

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';
// A control disabled while its action runs comes back. One that stays disabled must not leave focus nowhere for long.
const WAIT_FOR_DISABLED_MS = 8000;

const shown = (e: HTMLElement) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && e.getBoundingClientRect().right > 0;

/**
 * The page's live region, and two keyboard safety nets for the whole app.
 *
 * Focus: the button a student presses is often disabled while its server action runs, or replaced by what comes back. The
 * browser then drops focus to <body>, and a screen reader loses its place. If that happens with no navigation, this puts
 * focus back on the control when it returns, or on the nearest control where it was. Screens that have a better place to
 * send focus do so themselves, and this then does nothing. It never acts if focus went somewhere else, or was moved away
 * deliberately by a click on the page.
 *
 * Menus: a `details[data-menu]` closes on Escape and when focus leaves it, so it can't sit over what comes next.
 */
export function A11yRuntime() {
  useEffect(() => {
    let last: HTMLElement | null = null;
    let parents: HTMLElement[] = [];
    let top = 0;
    let path = window.location.pathname;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disabledSince = 0;

    const moveTo = (e: HTMLElement) => {
      disabledSince = 0;
      e.focus();
    };

    const rescue = () => {
      if (!last) return;
      const active = document.activeElement;
      if (active && active !== document.body) return;
      if (window.location.pathname !== path) {
        last = null;
        return;
      }
      if (last.isConnected && shown(last)) {
        if (!last.matches(":disabled")) return moveTo(last);
        disabledSince ||= Date.now();
        if (Date.now() - disabledSince < WAIT_FOR_DISABLED_MS) {
          timer = setTimeout(rescue, 300);
          return;
        }
      }
      const main = document.querySelector<HTMLElement>("main");
      for (const scope of parents) {
        if (!scope.isConnected) continue;
        if (main && scope !== main && scope.contains(main)) break;
        const near = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(shown).sort((a, b) => Math.abs(a.getBoundingClientRect().top + window.scrollY - top) - Math.abs(b.getBoundingClientRect().top + window.scrollY - top))[0];
        if (near) return moveTo(near);
      }
      if (main) {
        main.tabIndex = -1;
        moveTo(main);
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(rescue, 120);
    };

    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof HTMLElement) || t === document.body) return;
      last = t;
      disabledSince = 0;
      path = window.location.pathname;
      top = t.getBoundingClientRect().top + window.scrollY;
      parents = [];
      for (let p = t.parentElement; p && p !== document.body; p = p.parentElement) parents.push(p);
      // Focus has left an open menu: close it.
      document.querySelectorAll<HTMLDetailsElement>("details[data-menu][open]").forEach((d) => {
        if (!d.contains(t)) d.open = false;
      });
    };
    // Moved away on purpose (blur() or the window losing focus keep the element enabled and on the page): leave it alone.
    const onFocusOut = (e: FocusEvent) => {
      const t = e.target;
      setTimeout(() => {
        if (t === last && last && last.isConnected && !last.matches(":disabled") && shown(last) && document.activeElement !== last) last = null;
        schedule();
      }, 0);
    };
    // A click somewhere that takes focus runs onFocusIn straight after this; a click on the page itself should drop focus.
    const onPointerDown = () => {
      last = null;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const menu = document.activeElement?.closest<HTMLDetailsElement>("details[data-menu][open]");
      if (!menu) return;
      menu.open = false;
      menu.querySelector("summary")?.focus();
    };

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return <div id={LIVE_REGION_ID} role="status" aria-live="polite" className="sr-only-abs" />;
}
