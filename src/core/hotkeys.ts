import type { KeylineHotkeys } from "../types.js";
import { isTypingTarget } from "./dom.js";

/**
 * Hotkey bindings.
 *
 * Accepts simple keys ("k", "?") and modifier combos ("shift+g",
 * "cmd+shift+k"). Modifier names: shift, alt, ctrl, cmd (or meta).
 *
 * Two-mode listener:
 *  - `toggleAll` is ALWAYS active (the global key — default "k").
 *  - Family + ruler + HUD keys are only active when the overlay is ENABLED.
 *    A caller-supplied `isOverlayActive` predicate decides per keystroke.
 *  - This keeps key collisions to one bare letter in the host app's ambient
 *    namespace. Once you've summoned the overlay, the keyboard is keyline's.
 *
 * Rules:
 *  - Ignore inside `<input>`, `<textarea>`, `<select>`, contenteditable.
 *  - BARE keys reject any modifier press; COMBOS require exact match.
 *  - Empty string disables that binding.
 *  - `?` is treated as shift+/ but we also match `e.key === "?"` directly so
 *    different keyboard layouts work.
 */

export interface HotkeyActions {
  toggleAll: () => void;
  toggleKeylines: () => void;
  toggleColumns: () => void;
  toggleBaseline: () => void;
  toggleMargins: () => void;
  toggleRulers: () => void;
  showHud: () => void;
  /** Bare Esc: turn the overlay off when it's currently on. Internal. */
  closeOverlay: () => void;
}

export interface HotkeyBinder {
  unbind: () => void;
}

interface ParsedHotkey {
  key: string;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
}

function parseHotkey(spec: string): ParsedHotkey | null {
  const trimmed = spec.trim().toLowerCase();
  if (!trimmed) return null;
  const parts = trimmed
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const result: ParsedHotkey = {
    key: "",
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
  };
  for (const part of parts) {
    if (part === "shift") result.shift = true;
    else if (part === "alt" || part === "option") result.alt = true;
    else if (part === "ctrl" || part === "control") result.ctrl = true;
    else if (part === "cmd" || part === "meta" || part === "command")
      result.meta = true;
    else result.key = part;
  }
  if (!result.key) return null;
  return result;
}

function matches(parsed: ParsedHotkey, e: KeyboardEvent): boolean {
  const eventKey = e.key.toLowerCase();
  // Special case: "?" can arrive as either `?` directly (most layouts) or as
  // shift+`/` (US layout with shift down). Accept either to keep the binding
  // intuitive regardless of how the user typed it.
  if (parsed.key === "?") {
    if (eventKey !== "?" && !(eventKey === "/" && e.shiftKey)) return false;
    if (parsed.alt !== e.altKey) return false;
    if (parsed.ctrl !== e.ctrlKey) return false;
    if (parsed.meta !== e.metaKey) return false;
    return true;
  }
  if (eventKey !== parsed.key) return false;
  if (parsed.shift !== e.shiftKey) return false;
  if (parsed.alt !== e.altKey) return false;
  if (parsed.ctrl !== e.ctrlKey) return false;
  if (parsed.meta !== e.metaKey) return false;
  return true;
}

/**
 * `isOverlayActive` decides — on every keystroke, freshly — whether the
 * overlay is currently visible. When true, the in-mode keys fire. When false,
 * only `toggleAll` fires. We resolve at event time (not bind time) so
 * `bindHotkeys` doesn't need to be re-called when state changes.
 */
export function bindHotkeys(
  hotkeys: KeylineHotkeys,
  actions: HotkeyActions,
  isOverlayActive: () => boolean,
): HotkeyBinder {
  interface Binding {
    parsed: ParsedHotkey;
    action: () => void;
    /** "always" fires regardless of overlay state; "in-mode" only when overlay is enabled. */
    scope: "always" | "in-mode";
  }
  const bindings: Binding[] = [];

  const add = (spec: string, action: () => void, scope: Binding["scope"]) => {
    const parsed = parseHotkey(spec);
    if (parsed) bindings.push({ parsed, action, scope });
  };

  add(hotkeys.toggleAll, actions.toggleAll, "always");
  add(hotkeys.toggleKeylines, actions.toggleKeylines, "in-mode");
  add(hotkeys.toggleColumns, actions.toggleColumns, "in-mode");
  add(hotkeys.toggleBaseline, actions.toggleBaseline, "in-mode");
  add(hotkeys.toggleMargins, actions.toggleMargins, "in-mode");
  add(hotkeys.toggleRulers, actions.toggleRulers, "in-mode");
  add(hotkeys.showHud, actions.showHud, "in-mode");

  const handler = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;

    // Esc: turn the overlay off when it's on. Not user-configurable.
    if (e.key === "Escape" && isOverlayActive()) {
      // Don't intercept Esc when modifiers are held — those are reserved for
      // browser/system shortcuts.
      if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
        actions.closeOverlay();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    const active = isOverlayActive();
    for (const { parsed, action, scope } of bindings) {
      if (scope === "in-mode" && !active) continue;
      if (matches(parsed, e)) {
        action();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
  };

  if (typeof window === "undefined") return { unbind: () => {} };
  window.addEventListener("keydown", handler, { capture: true });
  return {
    unbind: () =>
      window.removeEventListener("keydown", handler, {
        capture: true,
      } as EventListenerOptions),
  };
}
