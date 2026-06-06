import type { ResolvedConfig } from "../types.js";
import { isTypingTarget, KEYLINE_CHROME_SELECTOR, round1 } from "./dom.js";
import type { KeylineStore } from "./store.js";

/**
 * Hold-B-and-click baseline scoping.
 *
 * Rhythm is a local contract: a card's text aligns to the card's grid, not
 * the page's. Hold the baseline key (default B) and click any component —
 * the baseline grid re-anchors to that element and paints only within its
 * bounds. Click the same element again (still holding B) to unscope. The
 * click is suppressed so the app underneath doesn't react.
 *
 * Tap B without clicking = plain family toggle (fires on keyup so the hold
 * gesture doesn't double-toggle).
 *
 * The scope is EPHEMERAL by design — element references can't survive a
 * reload. To make a scope durable, the team commits `data-keyline-rhythm`
 * on the component (the declared counterpart of this scratch gesture).
 */
export interface RhythmScope {
  get: () => HTMLElement | null;
  /** Manual grid offset in px (hold-B-drag). Wraps within one baseline step. */
  getOffset: () => number;
  destroy: () => void;
}

export interface RhythmScopeOptions {
  config: ResolvedConfig;
  store: KeylineStore;
  /** Repaint scheduler — called when the scope changes. */
  schedule: () => void;
}

export function mountRhythmScope(opts: RhythmScopeOptions): RhythmScope {
  if (typeof window === "undefined")
    return { get: () => null, getOffset: () => 0, destroy: () => {} };

  const { config, store, schedule } = opts;
  const key = config.hotkeys.toggleBaseline.trim().toLowerCase();

  let scopeEl: HTMLElement | null = null;
  let held = false;
  let clickedWhileHeld = false;

  // Hold-B-drag: nudge the grid vertically to meet the content (the border
  // box is the default anchor, but text rhythm starts after padding —
  // dragging is the tracing-paper fix). Wraps within the MAJOR period
  // (step × emphasizeEvery), not one minor step — wrapping at the minor
  // step would make a different line become the emphasized one every
  // `step` px of drag, so the solid line appears to jump around.
  const step = config.baseline?.step ?? 4;
  const wrapPeriod = step * (config.baseline?.emphasizeEvery || 1);
  let offset = 0;
  let offsetChip: HTMLDivElement | null = null;

  const showOffsetChip = (x: number, y: number) => {
    if (!offsetChip) {
      offsetChip = document.createElement("div");
      offsetChip.setAttribute("data-keyline-offset-chip", "");
      Object.assign(offsetChip.style, {
        position: "fixed",
        padding: "2px 7px",
        background: "rgba(18, 18, 18, 0.94)",
        color: "rgba(255, 255, 255, 0.92)",
        borderRadius: "4px",
        font: "10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        pointerEvents: "none",
        zIndex: "2147483647",
      } satisfies Partial<CSSStyleDeclaration>);
      document.body.appendChild(offsetChip);
    }
    offsetChip.textContent = `grid ${offset >= 0 ? "+" : ""}${round1(offset)}px`;
    offsetChip.style.left = `${x + 14}px`;
    offsetChip.style.top = `${y + 14}px`;
  };

  const hideOffsetChip = () => {
    offsetChip?.remove();
    offsetChip = null;
  };

  const setScope = (el: HTMLElement | null) => {
    scopeEl = el;
    offset = 0; // new anchor, fresh start
    schedule();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!key || e.key.toLowerCase() !== key) return;
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
    if (isTypingTarget(e.target)) return;
    if (!store.get().enabled) return;
    if (e.repeat) return;
    held = true;
    clickedWhileHeld = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (!key || e.key.toLowerCase() !== key) return;
    if (!held) return;
    held = false;
    // Tap (no click during hold) = plain family toggle, as before.
    if (!clickedWhileHeld) {
      store.toggleFamily("baseline");
      // Turning the family off drops the scope too — fresh start next time.
      if (!store.get().visibility.baseline) setScope(null);
    }
    // Reset AFTER use — leaving this true would make the click-swallower
    // eat every subsequent app click until the next B press.
    clickedWhileHeld = false;
  };

  // Capture-phase so we win against the app's own handlers; suppress the
  // click entirely (down, up, click) while B is held. A 3px movement
  // threshold splits the gesture: tap = scope to component, drag = offset
  // the grid.
  const DRAG_THRESHOLD = 3;
  const onPointerDown = (e: PointerEvent) => {
    if (!held || !store.get().enabled) return;
    e.preventDefault();
    e.stopPropagation();
    clickedWhileHeld = true;

    const startY = e.clientY;
    const startOffset = offset;
    let dragging = false;

    const onMove = (me: PointerEvent) => {
      const dy = me.clientY - startY;
      if (!dragging && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragging = true;
      // Wrap within the major period — an offset of one full period is the
      // identical grid, emphasized lines included.
      offset = (((startOffset + dy) % wrapPeriod) + wrapPeriod) % wrapPeriod;
      showOffsetChip(me.clientX, me.clientY);
      schedule();
    };

    const onUp = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      hideOffsetChip();
      if (dragging) return; // drag = offset only, no scope change

      const target = document.elementFromPoint(ue.clientX, ue.clientY);
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(KEYLINE_CHROME_SELECTOR)) return;
      // Tap the scoped element again to unscope; otherwise re-scope.
      setScope(
        target === scopeEl || scopeEl?.contains(target) === true
          ? null
          : target,
      );
      // Scoping implies the user wants the baseline visible.
      if (scopeEl && !store.get().visibility.baseline)
        store.toggleFamily("baseline");
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const swallow = (e: Event) => {
    if (!held && !clickedWhileHeld) return;
    if (e.type === "click" && clickedWhileHeld) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("keyup", onKeyUp, { capture: true });
  window.addEventListener("pointerdown", onPointerDown, { capture: true });
  window.addEventListener("click", swallow, { capture: true });

  return {
    get: () => (scopeEl?.isConnected ? scopeEl : null),
    getOffset: () => offset,
    destroy: () => {
      hideOffsetChip();
      window.removeEventListener("keydown", onKeyDown, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("keyup", onKeyUp, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("click", swallow, {
        capture: true,
      } as EventListenerOptions);
    },
  };
}
