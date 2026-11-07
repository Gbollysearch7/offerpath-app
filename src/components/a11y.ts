// Small browser helpers for keyboard and screen-reader users (OP-027). They only run in event handlers and effects.

export const LIVE_REGION_ID = "op-live";

let clearLive: ReturnType<typeof setTimeout> | undefined;

/** Says something through the page's one polite live region (A11yRuntime), for changes nothing else on screen announces. */
export function announce(text: string) {
  const el = document.getElementById(LIVE_REGION_ID);
  if (!el) return;
  el.textContent = "";
  // Emptied first, so the same words twice in a row are still a change a screen reader will read.
  setTimeout(() => {
    el.textContent = text;
  }, 60);
  clearTimeout(clearLive);
  clearLive = setTimeout(() => {
    el.textContent = "";
  }, 6000);
}

/** Moves focus once React has drawn what the current event changed. */
export function focusSoon(target: string | (() => HTMLElement | null | undefined)) {
  requestAnimationFrame(() => {
    const el = typeof target === "string" ? document.getElementById(target) : target();
    el?.focus();
  });
}

/**
 * Arrow keys, Home and End for a role="tablist". Put it on the list, and give each tab tabIndex={selected ? 0 : -1}:
 * one Tab stop for the group, and the arrows move between tabs and select them, as a screen reader tells people to expect.
 */
export function onTabListKey(e: { key: string; currentTarget: HTMLElement; preventDefault: () => void }) {
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)')];
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  const next = e.key === "ArrowRight" || e.key === "ArrowDown" ? (at + 1) % tabs.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (at - 1 + tabs.length) % tabs.length : e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}
