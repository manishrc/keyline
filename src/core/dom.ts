/**
 * Tiny DOM helpers shared across modules.
 *
 * Each module used to carry its own copy of these — style-injection booleans,
 * cssEscape polyfill, round1 helper, typing-target check, "skip keyline
 * chrome" selector, localStorage try/catch. Consolidated here.
 */

/** Selector matching every overlay surface keyline injects into the page. */
export const KEYLINE_CHROME_SELECTOR =
  "[data-keyline-button],[data-keyline-hud],[data-keyline-rulers],[data-keyline-overlay],[data-keyline-inspector]";

const _injected = new Set<string>();

/**
 * Inject a stylesheet once per id. Subsequent calls with the same id are no-ops,
 * so each module can call it from its mount path without bookkeeping.
 */
export function injectStylesOnce(id: string, css: string): void {
  if (typeof document === "undefined") return;
  if (_injected.has(id)) return;
  _injected.add(id);
  const style = document.createElement("style");
  style.setAttribute(id, "");
  style.textContent = css;
  document.head.appendChild(style);
}

/** Minimal CSS.escape polyfill for attribute-selector building. */
export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\\n\r]/g, "\\$&");
}

/** Round to one decimal. The readout precision used across drift/inspector/snapshot. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Does the event target look like a text-entry surface we should leave alone? */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** True if `el` sits inside any keyline-owned overlay surface. */
export function isKeylineChrome(el: Element): boolean {
  return !!el.closest(KEYLINE_CHROME_SELECTOR);
}

/**
 * localStorage read/write that swallows private-mode and quota errors. Returns
 * the raw string (or null) — callers parse. Non-fatal by design: a broken
 * storage layer should never break the overlay.
 */
export const safeStorage = {
  get(key: string): string | null {
    try {
      if (typeof localStorage === "undefined") return null;
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      if (typeof localStorage === "undefined") return;
      localStorage.setItem(key, value);
    } catch {
      // Private mode / quota — non-fatal.
    }
  },
};
