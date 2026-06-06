import type { Corner, ResolvedConfig } from "../types.js";
import { CORNER_EVENT, CORNER_KEY } from "./button.js";
import { injectStylesOnce, safeStorage } from "./dom.js";
import type { KeylineStore } from "./store.js";

/**
 * The keyboard HUD.
 *
 * A tiny labeled key map that appears the first few times the overlay is
 * activated — so the user discovers the in-mode shortcuts (M, C, B, L, R, ?)
 * once and then doesn't need it. Calling it back is `?`.
 *
 * Discovery model:
 *  - First N activations: HUD auto-shows for `AUTO_SHOW_MS` then fades out.
 *  - After that: HUD only shows when the user presses `?`.
 *  - User can also explicitly press `?` to recall at any time. We bump the
 *    seen count to capacity on explicit recall so it never reappears
 *    uninvited again.
 *  - Counter persisted in `keyline:hud-seen-count`.
 *
 * Lives next to the floating button (mirror corner if button is hidden).
 */

const AUTO_SHOW_TIMES = 3;
const AUTO_SHOW_MS = 4000;
// Versioned: bump when the keymap CONTENT changes so existing users see the
// updated map again — their old seen-count refers to a map that no longer
// exists.
const SEEN_KEY = "keyline:hud-seen-count:v3";

export interface KeyboardHud {
  /** Called when the user explicitly presses the `?` recall key. */
  show: () => void;
  destroy: () => void;
}

export interface KeyboardHudOptions {
  config: ResolvedConfig;
  store: KeylineStore;
  corner: Corner;
}

function readSeen(): number {
  const raw = safeStorage.get(SEEN_KEY);
  const n = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function writeSeen(value: number): void {
  safeStorage.set(SEEN_KEY, String(value));
}

const HUD_STYLES = `
[data-keyline-hud] {
  --klh-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --klh-out: cubic-bezier(0.16, 1, 0.3, 1);
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.8);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 0 0 0.5px rgba(0, 0, 0, 0.4),
    0 4px 12px rgba(0, 0, 0, 0.35),
    0 12px 32px rgba(0, 0, 0, 0.25);
  font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.02em;
  pointer-events: none;
  z-index: 2147483647;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  opacity: 0;
  transform: translateY(6px) scale(0.98);
  transition: opacity 220ms var(--klh-out), transform 240ms var(--klh-spring);
  max-width: 260px;
}
[data-keyline-hud][data-visible="true"] {
  opacity: 1;
  transform: translateY(0) scale(1);
}
[data-keyline-hud][data-corner="bottom-right"] { bottom: 56px; right: 12px; }
[data-keyline-hud][data-corner="bottom-left"]  { bottom: 56px; left: 12px; }
[data-keyline-hud][data-corner="top-right"]    { top: 56px; right: 12px; }
[data-keyline-hud][data-corner="top-left"]     { top: 56px; left: 12px; }
[data-keyline-hud] [data-klh-title] {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 2px;
}
[data-keyline-hud] [data-klh-row] {
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
[data-keyline-hud] [data-klh-key] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.95);
}
[data-keyline-hud] [data-klh-label] {
  color: rgba(255, 255, 255, 0.75);
}
@media (prefers-reduced-motion: reduce) {
  [data-keyline-hud] { transition: opacity 80ms linear !important; transform: none !important; }
}
@media print { [data-keyline-hud] { display: none !important; } }
`;

export function mountHud(opts: KeyboardHudOptions): KeyboardHud {
  if (typeof document === "undefined") {
    return { show: () => {}, destroy: () => {} };
  }
  injectStylesOnce("data-keyline-hud-style", HUD_STYLES);

  const { config, store, corner } = opts;
  const hotkeys = config.hotkeys;

  const root = document.createElement("div");
  root.setAttribute("data-keyline-hud", "");
  // Follow the pill: a user-dragged corner overrides the config prop, and
  // live drags re-corner the HUD via the corner event.
  root.setAttribute("data-corner", safeStorage.get(CORNER_KEY) ?? corner);
  root.setAttribute("aria-hidden", "true");
  const onCorner = (e: Event) => {
    root.setAttribute("data-corner", String((e as CustomEvent).detail));
  };
  window.addEventListener(CORNER_EVENT, onCorner);

  const title = document.createElement("div");
  title.setAttribute("data-klh-title", "");
  title.textContent = "keyline";
  root.appendChild(title);

  const rows: Array<[string, string, boolean]> = [
    [hotkeys.toggleAll, "Toggle overlay", true],
    [hotkeys.toggleMargins, "Margins", !!config.margins],
    [hotkeys.toggleColumns, "Columns", !!config.columns],
    [hotkeys.toggleBaseline, "Baseline", !!config.baseline],
    [hotkeys.toggleKeylines, "Lines", config.lines.length > 0],
    [hotkeys.toggleRulers, "Rulers", !!config.rulers],
    ["drag", "Guide from ruler", !!config.rulers],
    ["alt+drag", "Duplicate guide", !!config.rulers],
    ["2×click", "Remove guide", !!config.rulers],
    [`${hotkeys.toggleBaseline}+click`, "Scope rhythm", !!config.baseline],
    [`${hotkeys.toggleBaseline}+drag`, "Nudge grid", !!config.baseline],
    ["p", "Pin measurement", true],
    ["alt+click", "Select reference", true],
    [hotkeys.showHud, "This panel", true],
  ];

  for (const [keySpec, label, included] of rows) {
    if (!included || !keySpec) continue;
    const row = document.createElement("div");
    row.setAttribute("data-klh-row", "");
    const k = document.createElement("span");
    k.setAttribute("data-klh-key", "");
    k.textContent = humanizeSpec(keySpec);
    const t = document.createElement("span");
    t.setAttribute("data-klh-label", "");
    t.textContent = label;
    row.appendChild(k);
    row.appendChild(t);
    root.appendChild(row);
  }

  document.body.appendChild(root);

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  const reveal = (autoHideMs: number | null) => {
    root.setAttribute("data-visible", "true");
    if (hideTimer) clearTimeout(hideTimer);
    if (autoHideMs) {
      hideTimer = setTimeout(() => {
        root.setAttribute("data-visible", "false");
        hideTimer = null;
      }, autoHideMs);
    }
  };

  // Auto-show on overlay enable while user is still learning the shortcuts.
  let lastEnabled = store.get().enabled;
  const onEnable = () => {
    const seen = readSeen();
    if (seen >= AUTO_SHOW_TIMES) return;
    writeSeen(seen + 1);
    reveal(AUTO_SHOW_MS);
  };
  const unsubscribe = store.subscribe((state) => {
    const justEnabled = !lastEnabled && state.enabled;
    lastEnabled = state.enabled;
    if (justEnabled) onEnable();
    else if (!state.enabled) {
      // Overlay turned off → hide the HUD immediately.
      if (hideTimer) clearTimeout(hideTimer);
      root.setAttribute("data-visible", "false");
    }
  });

  // If the user explicitly presses `?` later, surface it and consider the
  // discovery phase done (so it doesn't auto-pop in future activations).
  const show = () => {
    writeSeen(Math.max(readSeen(), AUTO_SHOW_TIMES));
    reveal(AUTO_SHOW_MS);
  };

  return {
    show,
    destroy: () => {
      if (hideTimer) clearTimeout(hideTimer);
      window.removeEventListener(CORNER_EVENT, onCorner);
      unsubscribe();
      root.remove();
    },
  };
}

/** Format a hotkey spec for display in the HUD pip. "shift+k" → "⇧ K". */
function humanizeSpec(spec: string): string {
  const parts = spec
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  const mods: string[] = [];
  const keys: string[] = [];
  for (const p of parts) {
    if (p === "shift") mods.push("⇧");
    else if (p === "alt" || p === "option") mods.push("⌥");
    else if (p === "ctrl" || p === "control") mods.push("⌃");
    else if (p === "cmd" || p === "meta" || p === "command") mods.push("⌘");
    else
      keys.push(
        p === "?"
          ? "?"
          : p.includes("click") || p.includes("drag")
            ? p
            : p.toUpperCase(),
      );
  }
  const keyDisplay = keys.join(" ");
  return mods.length ? `${mods.join(" ")} ${keyDisplay}` : keyDisplay;
}
