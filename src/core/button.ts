import type { Corner, KeylineVisibility, ResolvedConfig } from "../types.js";
import { injectStylesOnce, safeStorage } from "./dom.js";
import type { KeylineStore } from "./store.js";

/**
 * Floating control button. Sits in a corner of the viewport (default
 * bottom-right). Quiet by default — a small pill with a dot. On hover it
 * expands to show toggles for the overlay families.
 *
 * Click the pill to toggle the whole overlay (same as G).
 * Click an inner toggle to flip that family.
 *
 * Not navigable by keyboard (it's a dev tool, not app chrome). Aria-hidden.
 */
export interface ControlButton {
  destroy: () => void;
}

export interface ControlButtonOptions {
  config: ResolvedConfig;
  store: KeylineStore;
  corner: Corner;
  /** Opens the keyboard HUD (the `?` chip). */
  onShowHud?: () => void;
}

/** User-dragged corner override — survives reloads, beats the config prop. */
export const CORNER_KEY = "keyline:corner:v1";
export const CORNER_EVENT = "keyline:corner";

function isCorner(v: unknown): v is Corner {
  return (
    v === "bottom-right" ||
    v === "bottom-left" ||
    v === "top-right" ||
    v === "top-left"
  );
}

const BUTTON_STYLES = `
[data-keyline-button] {
  --klb-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --klb-out: cubic-bezier(0.16, 1, 0.3, 1);
  --klb-inout: cubic-bezier(0.4, 0, 0.2, 1);

  position: fixed;
  display: flex;
  align-items: center;
  /* Collapsed: a 36px circle (gap 0, square padding). Hover: expands into
     the pill. Gap + padding are in the transition list, so the circle→pill
     morph is part of the same motion. */
  gap: 0;
  padding: 6px;
  background: rgba(0, 0, 0, 0.8);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  /* The inset top highlight + 0.5px ring are what make the glass read as a
     physical object on both dark and light pages. */
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 0.5px rgba(0, 0, 0, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.35),
    0 12px 32px rgba(0, 0, 0, 0.25);
  font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
  user-select: none;
  cursor: pointer;
  pointer-events: auto;
  opacity: 0.6;
  transform: scale(1);
  transform-origin: center;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  transition:
    opacity 220ms var(--klb-out),
    transform 240ms var(--klb-spring),
    background 220ms var(--klb-out),
    padding 240ms var(--klb-spring),
    gap 240ms var(--klb-spring);
  z-index: 2147483647;
  -webkit-tap-highlight-color: transparent;
  will-change: transform;
}
[data-keyline-button]:hover {
  opacity: 1;
  transform: scale(1.02);
  background: rgba(0, 0, 0, 0.86);
  gap: 6px;
  padding: 6px 10px;
}
/* While being dragged to another corner: follow the pointer, no easing. */
[data-keyline-button][data-dragging] {
  transition: none;
  cursor: grabbing;
  opacity: 1;
}
/* Press feedback belongs to whichever zone is pressed: chips handle their
   own :active; the pill only squishes when the pill BODY is pressed.
   (:active matches every ancestor of the pressed element, hence the :not.) */
[data-keyline-button]:active:not(:has([data-keyline-btoggle]:active)) {
  transform: scale(0.97);
  transition:
    transform 80ms var(--klb-inout),
    background 80ms var(--klb-inout);
}

[data-keyline-button][data-corner="bottom-right"] { bottom: 12px; right: 12px; transform-origin: bottom right; }
[data-keyline-button][data-corner="bottom-left"]  { bottom: 12px; left: 12px;  transform-origin: bottom left; }
[data-keyline-button][data-corner="top-right"]    { top: 12px; right: 12px;    transform-origin: top right; }
[data-keyline-button][data-corner="top-left"]     { top: 12px; left: 12px;     transform-origin: top left; }

/* Signifier: a crop mark made of keylines. Off = one quiet corner.
   On = the mirrored corner draws itself in, completing the frame. */
[data-keyline-button] [data-keyline-bdot] {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: rgba(255, 255, 255, 0.45);
  transition: color 220ms var(--klb-out);
}
[data-keyline-button] [data-keyline-bdot] svg {
  display: block;
  width: 14px;
  height: 14px;
  overflow: visible;
}
[data-keyline-button] [data-keyline-bdot] path {
  transition: transform 240ms var(--klb-spring);
}
[data-keyline-button] [data-keyline-bdot] [data-klb-corner="b"] {
  stroke-dasharray: 9;
  stroke-dashoffset: 9;
  transition: stroke-dashoffset 320ms var(--klb-out), transform 240ms var(--klb-spring);
}
[data-keyline-button][data-on="true"] [data-keyline-bdot] {
  color: var(--klb-accent, #f43f5e);
}
[data-keyline-button][data-on="true"] [data-keyline-bdot] [data-klb-corner="b"] {
  stroke-dashoffset: 0;
}
/* On hover the corners pinch toward each other — a tiny snap-settle. */
[data-keyline-button]:hover [data-keyline-bdot] [data-klb-corner="a"] { transform: translate(0.75px, 0.75px); }
[data-keyline-button]:hover [data-keyline-bdot] [data-klb-corner="b"] { transform: translate(-0.75px, -0.75px); }

@keyframes keyline-btn-breathe {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.82; }
}
[data-keyline-button][data-on="true"] [data-keyline-bdot] {
  animation: keyline-btn-breathe 3s var(--klb-inout) infinite;
}
[data-keyline-button]:hover [data-keyline-bdot] {
  animation: none;
}

[data-keyline-button] [data-keyline-blabel] {
  max-width: 0;
  opacity: 0;
  overflow: hidden;
  white-space: nowrap;
  transition:
    max-width 240ms var(--klb-spring),
    opacity 220ms var(--klb-out);
}
[data-keyline-button]:hover [data-keyline-blabel] {
  max-width: 80px;
  opacity: 0.85;
}

[data-keyline-button] [data-keyline-bgroup] {
  display: flex;
  gap: 4px;
  align-items: center;
  opacity: 0;
  max-width: 0;
  /* clip (not hidden) + a clip margin so chip borders never get shaved
     while the group is at rest; mid-transition clipping is masked by the
     delayed chip fade below. */
  overflow: clip;
  overflow-clip-margin: 4px;
  transition:
    max-width 320ms var(--klb-spring),
    opacity 240ms var(--klb-out),
    gap 240ms var(--klb-spring);
  pointer-events: none;
}
[data-keyline-button]:hover [data-keyline-bgroup] {
  opacity: 1;
  max-width: 240px;
  pointer-events: auto;
}

[data-keyline-button] [data-keyline-btoggle] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: 0 6px;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  border: 1px solid transparent;
  border-radius: 999px;
  font: inherit;
  cursor: pointer;
  letter-spacing: inherit;
  transform: translateY(2px);
  opacity: 0;
  transition:
    transform 320ms var(--klb-spring),
    opacity 240ms var(--klb-out),
    background 140ms var(--klb-out),
    color 140ms var(--klb-out),
    border-color 140ms var(--klb-out);
}
/* Chips fade in AFTER the container has mostly arrived — entering content
   should appear inside the surface, not be revealed by its clip edge. */
[data-keyline-button]:hover [data-keyline-btoggle] {
  opacity: 1;
  transform: translateY(0);
}
[data-keyline-button]:hover [data-keyline-btoggle]:nth-child(1) { transition-delay: 60ms, 60ms, 0ms, 0ms, 0ms; }
[data-keyline-button]:hover [data-keyline-btoggle]:nth-child(2) { transition-delay: 100ms, 100ms, 0ms, 0ms, 0ms; }
[data-keyline-button]:hover [data-keyline-btoggle]:nth-child(3) { transition-delay: 140ms, 140ms, 0ms, 0ms, 0ms; }
[data-keyline-button]:hover [data-keyline-btoggle]:nth-child(4) { transition-delay: 180ms, 180ms, 0ms, 0ms, 0ms; }
[data-keyline-button]:hover [data-keyline-btoggle]:nth-child(5) { transition-delay: 220ms, 220ms, 0ms, 0ms, 0ms; }

/* Three materials, not three opacities: off = quiet text, hover = surface,
   on = theme tint readable from across the room. */
[data-keyline-button] [data-keyline-btoggle]:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.85);
}
[data-keyline-button] [data-keyline-btoggle][data-on="true"] {
  background: color-mix(in srgb, var(--klb-accent, #f43f5e) 18%, transparent);
  color: color-mix(in srgb, var(--klb-accent, #f43f5e) 75%, white);
  border-color: color-mix(in srgb, var(--klb-accent, #f43f5e) 40%, transparent);
}
[data-keyline-button] [data-keyline-btoggle]:active {
  transform: translateY(0) scale(0.92);
  transition:
    transform 80ms var(--klb-inout),
    background 80ms var(--klb-inout);
}

@media (prefers-reduced-motion: reduce) {
  [data-keyline-button],
  [data-keyline-button] * {
    animation: none !important;
    transition: opacity 80ms linear !important;
    transform: none !important;
  }
}

@media print { [data-keyline-button] { display: none !important; } }
`;

export function mountControlButton(opts: ControlButtonOptions): ControlButton {
  if (typeof document === "undefined") return { destroy: () => {} };
  injectStylesOnce("data-keyline-button-style", BUTTON_STYLES);

  const { config, store, onShowHud } = opts;
  const stored = safeStorage.get(CORNER_KEY);
  const corner: Corner = isCorner(stored) ? stored : opts.corner;

  const root = document.createElement("div");
  root.setAttribute("data-keyline-button", "");
  root.setAttribute("data-corner", corner);
  root.setAttribute("aria-hidden", "true");
  root.style.setProperty("--klb-accent", config.theme.keyline);

  const dot = document.createElement("div");
  dot.setAttribute("data-keyline-bdot", "");
  dot.innerHTML =
    '<svg viewBox="0 0 14 14" fill="none">' +
    '<path data-klb-corner="a" d="M5.5 1.75 H1.75 V5.5" stroke="currentColor" stroke-width="1.5"/>' +
    '<path data-klb-corner="b" d="M8.5 12.25 H12.25 V8.5" stroke="currentColor" stroke-width="1.5"/>' +
    "</svg>";
  root.appendChild(dot);

  const labelText = document.createElement("span");
  labelText.setAttribute("data-keyline-blabel", "");
  labelText.textContent = "keyline";
  root.appendChild(labelText);

  // Family toggles — only show those configured.
  const group = document.createElement("div");
  group.setAttribute("data-keyline-bgroup", "");
  root.appendChild(group);

  const familyButtons: {
    family: keyof KeylineVisibility;
    el: HTMLButtonElement;
  }[] = [];

  const addToggle = (
    family: keyof KeylineVisibility,
    label: string,
    name: string,
    hotkey: string,
  ) => {
    const btn = document.createElement("button");
    btn.setAttribute("data-keyline-btoggle", "");
    btn.setAttribute("data-family", family);
    btn.title = `${name} (${hotkey.toUpperCase()})`;
    btn.textContent = label;
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.toggleFamily(family);
    });
    group.appendChild(btn);
    familyButtons.push({ family, el: btn });
  };

  // Lines toggle only when the config actually declares positional lines —
  // an empty family toggling "nothing" reads as a broken button.
  if (config.lines.length > 0)
    addToggle("keylines", "L", "Lines", config.hotkeys.toggleKeylines);
  if (config.columns)
    addToggle("columns", "C", "Columns", config.hotkeys.toggleColumns);
  if (config.baseline)
    addToggle("baseline", "B", "Baseline", config.hotkeys.toggleBaseline);
  if (config.margins)
    addToggle("margins", "M", "Margins", config.hotkeys.toggleMargins);

  if (onShowHud) {
    const btn = document.createElement("button");
    btn.setAttribute("data-keyline-btoggle", "");
    btn.title = `Shortcuts (${config.hotkeys.showHud})`;
    btn.textContent = "?";
    btn.type = "button";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onShowHud();
    });
    group.appendChild(btn);
  }

  // Click on the pill body (not on inner toggles) = toggle overall enabled.
  // A real drag (≥5px) re-corners the pill instead and swallows the click.
  let didDrag = false;
  root.addEventListener("click", () => {
    if (didDrag) return;
    store.toggleEnabled();
  });
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("[data-keyline-btoggle]")) return;
    didDrag = false;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = root.getBoundingClientRect();
    const offX = startX - rect.left;
    const offY = startY - rect.top;
    let dragging = false;
    const move = (me: PointerEvent) => {
      if (!dragging && Math.hypot(me.clientX - startX, me.clientY - startY) < 5)
        return;
      if (!dragging) {
        dragging = true;
        didDrag = true;
        root.setAttribute("data-dragging", "");
        try {
          root.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointerId */
        }
      }
      Object.assign(root.style, {
        left: `${me.clientX - offX}px`,
        top: `${me.clientY - offY}px`,
        right: "auto",
        bottom: "auto",
      } satisfies Partial<CSSStyleDeclaration>);
    };
    const up = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;
      root.removeAttribute("data-dragging");
      root.style.left =
        root.style.top =
        root.style.right =
        root.style.bottom =
          "";
      const vertical = ue.clientY < window.innerHeight / 2 ? "top" : "bottom";
      const horizontal = ue.clientX < window.innerWidth / 2 ? "left" : "right";
      const next: Corner = `${vertical}-${horizontal}`;
      root.setAttribute("data-corner", next);
      safeStorage.set(CORNER_KEY, next);
      window.dispatchEvent(new CustomEvent(CORNER_EVENT, { detail: next }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });

  // Render state → button visuals.
  const sync = () => {
    const state = store.get();
    root.setAttribute("data-on", String(state.enabled));
    for (const { family, el } of familyButtons) {
      el.setAttribute(
        "data-on",
        String(state.enabled && state.visibility[family]),
      );
    }
  };

  const unsubscribe = store.subscribe(() => sync());
  sync();

  document.body.appendChild(root);

  return {
    destroy: () => {
      unsubscribe();
      root.remove();
    },
  };
}
