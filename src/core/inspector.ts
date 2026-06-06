import type { ResolvedConfig } from "../types.js";
import {
  injectStylesOnce,
  isKeylineChrome,
  isTypingTarget,
  round1,
  safeStorage,
} from "./dom.js";
import { computeGeometry, nearestOnAxis } from "./geometry.js";
import { gapBetween, insetDistances, isOnScale, type Rect } from "./measure.js";
import type { KeylineStore } from "./store.js";

/**
 * Inspector v2 — local references, Figma-style.
 *
 * The reference for a measurement is LOCAL to the component, not the page:
 *
 *  - Hover alone → reference is the PARENT. Shows the element's size and
 *    the four inset distances to the parent's edges (effective padding).
 *  - Click → the element becomes the selected reference. Hovering anything
 *    else measures the gap BETWEEN the two (Figma select-then-hover).
 *    Click the selection again (or Esc) to clear.
 *  - Page-grid drift is a secondary readout, shown only when the hovered
 *    element's parent IS the content container — top-level sections are the
 *    only elements that answer to the page grid.
 *
 * Pins: press P while hovering to pin the current measurement. Pins persist
 * per-path, live-update through HMR (the registry's paint tick drives them),
 * and turn green when the measurement lands on the spacing scale (gaps /
 * insets) or at zero drift (grid). Tweak code, watch it go green.
 *
 * Mouse-only; touch gets tap-to-measure in a later slice.
 */
export interface Inspector {
  /** Clear the click-selection. Returns true if there was one (Esc layering). */
  clearSelection: () => boolean;
  /** Called by the registry on every paint tick — drives pin live-updates. */
  tick: () => void;
  destroy: () => void;
}

export interface InspectorOptions {
  config: ResolvedConfig;
  store: KeylineStore;
  /** Active hold-B-click baseline scope, if any — keeps readouts truthful. */
  getBaselineScope?: () => HTMLElement | null;
  /** Manual hold-B-drag grid offset — readouts must match the painted grid. */
  getBaselineOffset?: () => number;
}

/** Grid-drift window — beyond this it's layout, not misalignment. */
const DRIFT_MAX = 24;
const DRIFT_MIN = 0.5;
/** Ambient hover lines longer than this are empty space, not spacing. */
const AMBIENT_MAX = 160;

const PINS_KEY_PREFIX = "keyline:pins:v1:";

interface Pin {
  id: string;
  targetPath: string;
  /** null = measure against parent. */
  refPath: string | null;
}

const STYLES = `
[data-keyline-inspector] {
  position: fixed;
  inset: 0;
  pointer-events: none;
  /* Above the rulers: measurement readouts are transient and must never be
     obscured by ruler chrome. */
  z-index: 2147483646;
  font: 10px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
[data-keyline-inspector] [data-ki-hover],
[data-keyline-inspector] [data-ki-selected] {
  position: absolute;
  display: none;
}
[data-keyline-inspector] [data-ki-hover] {
  border: 1px solid rgba(56, 189, 248, 0.9);
  background: rgba(56, 189, 248, 0.04);
}
[data-keyline-inspector] [data-ki-selected] {
  border: 1px solid rgba(236, 72, 153, 0.95);
  background: rgba(236, 72, 153, 0.05);
}
[data-keyline-inspector] [data-ki-lines] { position: absolute; inset: 0; }
[data-keyline-inspector] [data-ki-line] {
  position: absolute;
  background: rgba(252, 165, 165, 0.9);
}
[data-keyline-inspector] [data-ki-line][data-on-scale="true"] {
  background: rgba(134, 239, 172, 0.9);
}
[data-keyline-inspector] [data-ki-num] {
  position: absolute;
  transform: translate(-50%, -50%);
  padding: 1px 4px;
  background: rgba(18, 18, 18, 0.94);
  border-radius: 3px;
  color: rgba(252, 165, 165, 1);
}
[data-keyline-inspector] [data-ki-num][data-on-scale="true"] {
  color: rgba(134, 239, 172, 1);
}
[data-keyline-inspector] [data-ki-chip] {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 3px 8px;
  background: rgba(18, 18, 18, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 5px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
  white-space: nowrap;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
[data-keyline-inspector] [data-ki-dims] { color: rgba(255, 255, 255, 0.92); }
[data-keyline-inspector] [data-ki-dims] [data-ki-times] { color: rgba(255, 255, 255, 0.35); padding: 0 1px; }
[data-keyline-inspector] [data-ki-sep] { width: 1px; height: 10px; background: rgba(255, 255, 255, 0.14); }
[data-keyline-inspector] [data-ki-drift] { color: rgba(252, 165, 165, 0.9); }
[data-keyline-inspector] [data-ki-drift] [data-ki-axis] { color: rgba(252, 165, 165, 0.55); margin-right: 3px; }

[data-keyline-inspector] [data-ki-pin] {
  position: absolute;
  padding: 2px 7px;
  background: rgba(18, 18, 18, 0.94);
  border: 1px solid rgba(252, 165, 165, 0.45);
  border-radius: 4px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  color: rgba(252, 165, 165, 1);
  pointer-events: auto;
  cursor: pointer;
  white-space: nowrap;
}
[data-keyline-inspector] [data-ki-pin][data-ok="true"] {
  border-color: rgba(134, 239, 172, 0.5);
  color: rgba(134, 239, 172, 1);
}
@media print { [data-keyline-inspector] { display: none !important; } }
`;

function toRect(r: DOMRect): Rect {
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

/** Build a resilient-enough CSS path for pin persistence across HMR. */
function cssPath(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && parts.length < 12) {
    const parent: Element | null = node.parentElement;
    if (!parent) break;
    const idx = Array.prototype.indexOf.call(parent.children, node) + 1;
    parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${idx})`);
    node = parent;
  }
  return parts.join(" > ");
}

function fromPath(path: string): HTMLElement | null {
  try {
    const el = document.body.querySelector(path);
    return el instanceof HTMLElement ? el : null;
  } catch {
    return null;
  }
}

export function mountInspector(opts: InspectorOptions): Inspector {
  if (typeof document === "undefined") {
    return { clearSelection: () => false, tick: () => {}, destroy: () => {} };
  }
  injectStylesOnce("data-keyline-inspector-style", STYLES);

  const { config, store, getBaselineScope, getBaselineOffset } = opts;
  const step = config.baseline?.step ?? 4;
  const pinsKey = PINS_KEY_PREFIX + (location.pathname || "/");

  const root = document.createElement("div");
  root.setAttribute("data-keyline-inspector", "");
  root.setAttribute("aria-hidden", "true");

  const hoverBox = document.createElement("div");
  hoverBox.setAttribute("data-ki-hover", "");
  const selectedBox = document.createElement("div");
  selectedBox.setAttribute("data-ki-selected", "");
  const lines = document.createElement("div");
  lines.setAttribute("data-ki-lines", "");
  const chip = document.createElement("div");
  chip.setAttribute("data-ki-chip", "");
  chip.style.display = "none";
  const pinsLayer = document.createElement("div");
  pinsLayer.style.position = "absolute";
  pinsLayer.style.inset = "0";

  root.append(hoverBox, selectedBox, lines, chip, pinsLayer);
  document.body.appendChild(root);

  let hoverEl: HTMLElement | null = null;
  let selectedEl: HTMLElement | null = null;
  let lastX = 0;
  let lastY = 0;
  let raf = 0;

  // ---- pins -------------------------------------------------------------
  let pins: Pin[] = readPins(pinsKey);
  const pinEls = new Map<string, HTMLDivElement>();

  function paintPins(): void {
    // Pins are part of the overlay — overlay off, pins off.
    pinsLayer.style.display = store.get().enabled ? "" : "none";
    if (!store.get().enabled) return;
    const liveIds = new Set(pins.map((p) => p.id));
    for (const [id, el] of pinEls) {
      if (!liveIds.has(id)) {
        el.remove();
        pinEls.delete(id);
      }
    }
    for (const pin of pins) {
      const target = fromPath(pin.targetPath);
      let el = pinEls.get(pin.id);
      if (!target) {
        // Element gone (HMR remount in flight) — hide, keep the pin.
        if (el) el.style.display = "none";
        continue;
      }
      if (!el) {
        el = document.createElement("div");
        el.setAttribute("data-ki-pin", "");
        el.title = "Click to unpin";
        const id = pin.id;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          pins = pins.filter((p) => p.id !== id);
          writePins(pinsKey, pins);
          paintPins();
        });
        pinsLayer.appendChild(el);
        pinEls.set(pin.id, el);
      }
      const tRect = toRect(target.getBoundingClientRect());
      const ref = pin.refPath ? fromPath(pin.refPath) : target.parentElement;
      let text = "";
      let ok = false;
      if (ref) {
        const rRect = toRect(ref.getBoundingClientRect());
        if (pin.refPath) {
          const { gap } = gapBetween(tRect, rRect);
          ok = isOnScale(gap, step);
          text = `gap ${round1(gap)}${ok ? " ✓" : ""}`;
        } else {
          const inset = insetDistances(tRect, rRect);
          ok = isOnScale(inset.left, step) && isOnScale(inset.top, step);
          text = `↤${round1(inset.left)} ↥${round1(inset.top)}${ok ? " ✓" : ""}`;
        }
      }
      el.style.display = "";
      el.setAttribute("data-ok", String(ok));
      el.textContent = text;
      el.style.left = `${Math.max(4, tRect.left)}px`;
      el.style.top = `${Math.max(4, tRect.top - 22)}px`;
    }
  }

  function pinCurrent(): void {
    if (!hoverEl) return;
    pins = [
      ...pins,
      {
        id: `p_${Math.random().toString(36).slice(2, 9)}`,
        targetPath: cssPath(hoverEl),
        refPath:
          selectedEl && selectedEl !== hoverEl ? cssPath(selectedEl) : null,
      },
    ];
    writePins(pinsKey, pins);
    paintPins();
  }

  // ---- live hover paint ---------------------------------------------------
  function clearLines(): void {
    lines.textContent = "";
  }

  function drawLine(
    axis: "x" | "y",
    from: number,
    to: number,
    at: number,
    onScale: boolean,
    showNum = true,
    maxLen = Infinity,
  ): void {
    // Sub-2px gaps are borders and fractional-layout noise, not spacing —
    // nobody designs a 1.7px inset. Measuring them is technically true and
    // practically meaningless. Same for ambient spans past `maxLen`: a
    // 470px "distance to container edge" isn't spacing, it's empty space.
    if (Math.abs(to - from) < 2 || Math.abs(to - from) > maxLen) return;
    const line = document.createElement("div");
    line.setAttribute("data-ki-line", "");
    line.setAttribute("data-on-scale", String(onScale));
    const lo = Math.min(from, to);
    const len = Math.abs(to - from);
    if (axis === "x") {
      Object.assign(line.style, {
        left: `${lo}px`,
        top: `${at}px`,
        width: `${len}px`,
        height: "1px",
      });
    } else {
      Object.assign(line.style, {
        top: `${lo}px`,
        left: `${at}px`,
        height: `${len}px`,
        width: "1px",
      });
    }
    lines.appendChild(line);
    if (!showNum) return;
    const num = document.createElement("div");
    num.setAttribute("data-ki-num", "");
    num.setAttribute("data-on-scale", String(onScale));
    num.textContent = String(round1(len));
    // Short lines (common 8/12px paddings) keep their number — it sits
    // BESIDE the line instead of on it so it doesn't swallow the gap it
    // measures. Only small ELEMENTS fold numbers into the chip (caller).
    const beside = len < 16;
    if (axis === "x") {
      num.style.left = `${lo + len / 2}px`;
      num.style.top = `${at - (beside ? 14 : 10)}px`;
    } else {
      num.style.top = `${lo + len / 2}px`;
      num.style.left = `${at + (beside ? 24 : 18)}px`;
    }
    lines.appendChild(num);
  }

  function hide(): void {
    hoverBox.style.display = "none";
    chip.style.display = "none";
    clearLines();
    hoverEl = null;
  }

  function paintSelection(): void {
    if (selectedEl?.isConnected) {
      const r = selectedEl.getBoundingClientRect();
      Object.assign(selectedBox.style, {
        display: "block",
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    } else {
      selectedBox.style.display = "none";
    }
  }

  function paint(): void {
    raf = 0;
    paintSelection();
    if (!store.get().enabled) {
      hide();
      return;
    }

    const el = document.elementFromPoint(lastX, lastY);
    if (
      !el ||
      el === document.documentElement ||
      el === document.body ||
      isKeylineChrome(el) ||
      !(el instanceof HTMLElement)
    ) {
      hide();
      return;
    }

    // Focus mode: while a rhythm scope is active (hold-B-click), the rest of
    // the page is dimmed and irrelevant — hover highlights out there are
    // noise. The inspector only responds INSIDE the scoped component.
    const focusScope = getBaselineScope?.();
    if (focusScope?.isConnected && !focusScope.contains(el)) {
      hide();
      return;
    }

    hoverEl = el;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      hide();
      return;
    }
    const r = toRect(rect);

    Object.assign(hoverBox.style, {
      display: "block",
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });

    clearLines();
    chip.textContent = "";

    if (selectedEl && selectedEl !== el && selectedEl.isConnected) {
      // Selection mode: measure BETWEEN selection and hover.
      const sRect = toRect(selectedEl.getBoundingClientRect());
      const { axis, gap } = gapBetween(r, sRect);
      const ok = isOnScale(gap, step);
      if (axis === "y") {
        const top = Math.min(r.bottom, sRect.bottom);
        const overlapL = Math.max(r.left, sRect.left);
        const overlapR = Math.min(r.right, sRect.right);
        const at =
          overlapR > overlapL
            ? (overlapL + overlapR) / 2
            : (r.left + r.right) / 2;
        drawLine("y", top, top + gap, at, ok);
      } else {
        const left = Math.min(r.right, sRect.right);
        const overlapT = Math.max(r.top, sRect.top);
        const overlapB = Math.min(r.bottom, sRect.bottom);
        const at =
          overlapB > overlapT
            ? (overlapT + overlapB) / 2
            : (r.top + r.bottom) / 2;
        drawLine("x", left, left + gap, at, ok);
      }
      setChip(r, rect.width, rect.height, [
        ["gap", `${round1(gap)}${ok ? " ✓" : ""}`],
      ]);
      return;
    }

    // Default mode: reference = the VISUAL container, not the literal DOM
    // parent. Layout trees are full of invisible wrappers that are exactly
    // the size of their content — measuring against those yields all-zero
    // insets and no lines, which reads as "inspector randomly does nothing."
    // Walk up past any ancestor whose box matches ours (±1px) until we find
    // one that actually contains the element with room to spare.
    let parent = el.parentElement;
    while (
      parent &&
      parent !== document.body &&
      parent !== document.documentElement &&
      rectsNearlyEqual(toRect(parent.getBoundingClientRect()), r)
    ) {
      parent = parent.parentElement;
    }
    const insetExtras: [string, string][] = [];
    if (
      parent &&
      parent !== document.body &&
      parent !== document.documentElement
    ) {
      const p = toRect(parent.getBoundingClientRect());

      // Per side, the meaningful reference is the NEAREST thing in that
      // direction: a sibling when one sits between us and the container
      // edge (that's the flex/grid gap), the container edge otherwise.
      // "inset 80 to the bottom" past a button is noise; "gap 16 to the
      // button" is the measurement the user actually wants.
      const sibRects: Rect[] = [];
      for (const child of Array.from(parent.children)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child === el || child.contains(el) || el.contains(child)) continue;
        if (isKeylineChrome(child)) continue;
        const cr = child.getBoundingClientRect();
        if (cr.width <= 0 && cr.height <= 0) continue;
        sibRects.push(toRect(cr));
      }
      const vOverlap = (s: Rect) => s.top < r.bottom && s.bottom > r.top;
      const hOverlap = (s: Rect) => s.left < r.right && s.right > r.left;
      let topEdge = p.top;
      let rightEdge = p.right;
      let bottomEdge = p.bottom;
      let leftEdge = p.left;
      for (const s of sibRects) {
        if (vOverlap(s)) {
          if (s.left >= r.right - 1 && s.left < rightEdge) rightEdge = s.left;
          if (s.right <= r.left + 1 && s.right > leftEdge) leftEdge = s.right;
        }
        if (hOverlap(s)) {
          if (s.top >= r.bottom - 1 && s.top < bottomEdge) bottomEdge = s.top;
          if (s.bottom <= r.top + 1 && s.bottom > topEdge) topEdge = s.bottom;
        }
      }

      const d = {
        top: r.top - topEdge,
        right: rightEdge - r.right,
        bottom: bottomEdge - r.bottom,
        left: r.left - leftEdge,
      };
      const midX = (r.left + r.right) / 2;
      const midY = (r.top + r.bottom) / 2;
      // Numbers fold into the chip only when the element is small in BOTH
      // dimensions — that's when bubbles physically collide. A wide-but-
      // short title has plenty of room for on-line numbers.
      const small = rect.width < 64 && rect.height < 64;
      drawLine(
        "y",
        topEdge,
        r.top,
        midX,
        isOnScale(d.top, step),
        !small,
        AMBIENT_MAX,
      );
      drawLine(
        "y",
        r.bottom,
        bottomEdge,
        midX,
        isOnScale(d.bottom, step),
        !small,
        AMBIENT_MAX,
      );
      drawLine(
        "x",
        leftEdge,
        r.left,
        midY,
        isOnScale(d.left, step),
        !small,
        AMBIENT_MAX,
      );
      drawLine(
        "x",
        r.right,
        rightEdge,
        midY,
        isOnScale(d.right, step),
        !small,
        AMBIENT_MAX,
      );
      const meaningful = [d.top, d.right, d.bottom, d.left].some(
        (v) => Math.abs(v) >= 2,
      );
      if (small && meaningful) {
        insetExtras.push([
          "inset",
          `${round1(d.top)} ${round1(d.right)} ${round1(d.bottom)} ${round1(d.left)}`,
        ]);
      }
    }

    // Secondary: page-grid drift, ONLY for direct children of the content
    // container — they're the only elements that answer to the page grid.
    const driftParts: [string, string][] = [];
    const anchorName = config.margins?.anchor;
    if (anchorName && parent?.getAttribute("data-keyline") === anchorName) {
      const geometry = computeGeometry(
        config,
        getBaselineScope?.() ?? null,
        getBaselineOffset?.() ?? 0,
      );
      const nx = nearestOnAxis(geometry, "x", r.left);
      const ny = nearestOnAxis(geometry, "y", r.top);
      if (
        nx &&
        Math.abs(nx.delta) >= DRIFT_MIN &&
        Math.abs(nx.delta) <= DRIFT_MAX
      ) {
        driftParts.push([
          "x",
          `${nx.delta > 0 ? "+" : ""}${round1(nx.delta)} off ${nx.kind}`,
        ]);
      }
      if (
        ny &&
        Math.abs(ny.delta) >= DRIFT_MIN &&
        Math.abs(ny.delta) <= DRIFT_MAX
      ) {
        driftParts.push([
          "y",
          `${ny.delta > 0 ? "+" : ""}${round1(ny.delta)} off ${ny.kind}`,
        ]);
      }
    }
    setChip(r, rect.width, rect.height, [...insetExtras, ...driftParts]);
  }

  function setChip(
    r: Rect,
    w: number,
    h: number,
    extras: [string, string][],
  ): void {
    chip.textContent = "";
    const dims = document.createElement("span");
    dims.setAttribute("data-ki-dims", "");
    dims.appendChild(document.createTextNode(String(round1(w))));
    const times = document.createElement("span");
    times.setAttribute("data-ki-times", "");
    times.textContent = "×";
    dims.appendChild(times);
    dims.appendChild(document.createTextNode(String(round1(h))));
    chip.appendChild(dims);
    if (extras.length > 0) {
      const sep = document.createElement("span");
      sep.setAttribute("data-ki-sep", "");
      chip.appendChild(sep);
      const drift = document.createElement("span");
      drift.setAttribute("data-ki-drift", "");
      for (const [label, text] of extras) {
        const axisEl = document.createElement("span");
        axisEl.setAttribute("data-ki-axis", "");
        axisEl.textContent = label;
        drift.appendChild(axisEl);
        drift.appendChild(document.createTextNode(`${text} `));
      }
      chip.appendChild(drift);
    }
    chip.style.display = "inline-flex";
    const chipTop =
      r.bottom + 6 > window.innerHeight - 24 ? r.top - 26 : r.bottom + 6;
    chip.style.left = `${Math.max(4, r.left)}px`;
    chip.style.top = `${Math.max(4, chipTop)}px`;
  }

  // ---- events -------------------------------------------------------------
  const schedulePaint = () => {
    if (!raf) raf = requestAnimationFrame(paint);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    if (!store.get().enabled) return;
    lastX = e.clientX;
    lastY = e.clientY;
    schedulePaint();
  };

  // ALT+click selects the hovered element as reference; Alt+click the
  // selection again to clear. Modifier-gated so plain clicks still reach the
  // app — the overlay is a lens, not a modal. Capture + suppression so the
  // app doesn't also react to the Alt+click.
  const onClick = (e: MouseEvent) => {
    if (!store.get().enabled) return;
    if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || !(el instanceof HTMLElement) || isKeylineChrome(el)) return;
    e.preventDefault();
    e.stopPropagation();
    selectedEl = el === selectedEl ? null : el;
    schedulePaint();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!store.get().enabled) return;
    if (isTypingTarget(e.target)) return;
    if (
      e.key.toLowerCase() === "p" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey
    ) {
      pinCurrent();
      e.preventDefault();
      e.stopPropagation();
    } else if (e.key === "Escape" && selectedEl) {
      selectedEl = null;
      schedulePaint();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const onLeave = () => hide();

  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("click", onClick, { capture: true });
  window.addEventListener("keydown", onKeyDown, { capture: true });
  window.addEventListener("pointerleave", onLeave);
  const unsubscribe = store.subscribe((state) => {
    if (!state.enabled) {
      hide();
      selectedEl = null;
      paintSelection();
    }
    paintPins();
  });

  paintPins();

  return {
    clearSelection: () => {
      if (!selectedEl) return false;
      selectedEl = null;
      schedulePaint();
      return true;
    },
    tick: () => {
      paintPins();
      if (hoverEl) schedulePaint();
    },
    destroy: () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("click", onClick, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("keydown", onKeyDown, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("pointerleave", onLeave);
      unsubscribe();
      root.remove();
    },
  };
}

function readPins(key: string): Pin[] {
  const raw = safeStorage.get(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is Pin =>
        !!p &&
        typeof p === "object" &&
        typeof (p as Pin).id === "string" &&
        typeof (p as Pin).targetPath === "string",
    );
  } catch {
    return [];
  }
}

function writePins(key: string, pins: Pin[]): void {
  safeStorage.set(key, JSON.stringify(pins));
}

function rectsNearlyEqual(a: Rect, b: Rect, tolerance = 2): boolean {
  return (
    Math.abs(a.left - b.left) <= tolerance &&
    Math.abs(a.top - b.top) <= tolerance &&
    Math.abs(a.right - b.right) <= tolerance &&
    Math.abs(a.bottom - b.bottom) <= tolerance
  );
}
