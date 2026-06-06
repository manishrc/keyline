import { parseOffset, resolveLine } from "../config.js";
import type { ResolvedConfig } from "../types.js";
import type { ElementSpec } from "./registry.js";
import type { KeylineState } from "./store.js";

/**
 * Paints the overlay. One fixed layer at viewport size, z-MAX_SAFE_INTEGER,
 * pointer-events:none, aria-hidden.
 *
 * Strategy:
 *  - Baseline + columns: one element each, `repeating-linear-gradient`.
 *  - Margins: two strips (or four if per-element).
 *  - Edge keylines per data-keyline element: thin lines at viewport height.
 *    Labels are HIDDEN by default; small dot signifier (~6px) at the top of
 *    each line. Hovering the line or signifier reveals the label chip.
 *    Multiple labels at near-overlapping x stack vertically when revealed.
 *  - Positional lines: same model as edges, but viewport-anchored.
 */
export class KeylineRenderer {
  private root: HTMLDivElement | null = null;
  private style: HTMLStyleElement | null = null;
  private marginsEl: HTMLDivElement | null = null;
  private columnsEl: HTMLDivElement | null = null;
  private baselineEl: HTMLDivElement | null = null;
  private keylinesEl: HTMLDivElement | null = null;

  /**
   * Hold-B-click scope: when set, the baseline grid re-anchors to this
   * element and paints only within its bounds. Set by the registry before
   * each paint tick.
   */
  baselineScope: HTMLElement | null = null;

  /** Manual grid nudge from hold-B-drag, in px. Applied on top of the anchor. */
  baselineOffset = 0;

  constructor(private config: ResolvedConfig) {}

  private ensureRoot(): HTMLDivElement {
    if (this.root) return this.root;

    const root = document.createElement("div");
    root.setAttribute("data-keyline-overlay", "");
    root.setAttribute("aria-hidden", "true");
    Object.assign(root.style, {
      position: "fixed",
      top: "0",
      left: "0",
      right: "0",
      bottom: "0",
      pointerEvents: "none",
      zIndex: String(this.config.zIndex),
      isolation: "isolate",
      contain: "strict",
      ...(this.config.blend ? { mixBlendMode: "difference" } : {}),
    } satisfies Partial<CSSStyleDeclaration>);

    // Layer order: margins (back) → columns → baseline → keylines (front)
    const margins = document.createElement("div");
    const columns = document.createElement("div");
    const baseline = document.createElement("div");
    const keylines = document.createElement("div");
    for (const el of [margins, columns, baseline, keylines]) {
      Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      } satisfies Partial<CSSStyleDeclaration>);
      root.appendChild(el);
    }

    // Stylesheet for hover reveal + reduced-motion + print
    const style = document.createElement("style");
    style.textContent = STYLES;

    this.root = root;
    this.style = style;
    this.marginsEl = margins;
    this.columnsEl = columns;
    this.baselineEl = baseline;
    this.keylinesEl = keylines;

    document.body.appendChild(root);
    document.head.appendChild(style);
    return root;
  }

  /**
   * Columns. Two anchoring modes:
   *
   *   1. Margins-anchored ("Figma frame" model): when margins config is set
   *      with an `anchor`, columns AUTO-INSET inside the same anchored
   *      element by `margins.width`. Columns sit between the margin strips.
   *      One source of truth for "where content lives."
   *
   *   2. Viewport-anchored (fallback): centered in the viewport with the
   *      column grid's own `margin` and `maxWidth`. Used when no margins
   *      anchor is in play.
   */
  private paintColumns(visible: boolean, specs: ElementSpec[]): void {
    const el = this.columnsEl!;
    const grid = this.config.columns;
    el.innerHTML = "";
    if (!visible || !grid) {
      el.style.backgroundImage = "";
      el.style.width = "auto";
      el.style.left = "0";
      return;
    }

    const { count, gutter, margin, maxWidth, fill } = grid;
    const color = this.config.theme.column;
    const edge = this.config.theme.keyline;
    const vw = window.innerWidth;

    // Resolve the column band's left edge + content width.
    let left: number;
    let contentWidth: number;

    const marginsCfg = this.config.margins;
    const anchorEl = marginsCfg?.anchor
      ? specs.find((s) => s.label === marginsCfg.anchor)?.el
      : undefined;

    if (anchorEl && marginsCfg) {
      // Margins-anchored: inset INSIDE the anchored element by margin width.
      const rect = anchorEl.getBoundingClientRect();
      const marginWidth = parseOffset(marginsCfg.width, rect.width);
      left = rect.left + marginWidth;
      contentWidth = rect.width - marginWidth * 2;
    } else {
      // Viewport fallback.
      contentWidth = maxWidth
        ? Math.min(maxWidth, vw - margin * 2)
        : vw - margin * 2;
      left = maxWidth ? Math.max(margin, (vw - contentWidth) / 2) : margin;
    }

    // Guard: when the band collapses (mobile, narrow container), don't paint.
    if (contentWidth <= count) {
      el.style.backgroundImage = "";
      return;
    }

    const totalGutter = gutter * (count - 1);
    const colWidth = (contentWidth - totalGutter) / count;

    const stops: string[] = [];
    if (fill) {
      stops.push(
        `${color} 0, ${color} ${colWidth}px`,
        `transparent ${colWidth}px, transparent ${colWidth + gutter}px`,
      );
    } else {
      stops.push(
        `${edge} 0, ${edge} 1px`,
        `transparent 1px, transparent ${colWidth}px`,
        `${edge} ${colWidth}px, ${edge} ${colWidth + 1}px`,
        `transparent ${colWidth + 1}px, transparent ${colWidth + gutter}px`,
      );
    }

    Object.assign(el.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      left: `${left}px`,
      width: `${contentWidth}px`,
      backgroundImage: `repeating-linear-gradient(to right, ${stops.join(", ")})`,
      backgroundSize: `${colWidth + gutter}px 100%`,
      backgroundRepeat: "repeat-x",
    } satisfies Partial<CSSStyleDeclaration>);
  }

  private paintBaseline(visible: boolean, specs: ElementSpec[]): void {
    const el = this.baselineEl!;
    const grid = this.config.baseline;
    if (!visible || !grid) {
      el.style.backgroundImage = "";
      return;
    }
    const { step, emphasizeEvery } = grid;

    // Scoped mode (hold-B-click): the grid belongs to ONE component — paint
    // only within its rect, row 0 at its top. Rhythm is a local contract.
    const scope = this.baselineScope?.isConnected ? this.baselineScope : null;
    if (scope) {
      const r = scope.getBoundingClientRect();
      Object.assign(el.style, {
        position: "absolute",
        inset: "auto",
        left: `${snapToDevicePx(r.left)}px`,
        top: `${snapToDevicePx(r.top)}px`,
        width: `${snapToDevicePx(r.width)}px`,
        height: `${snapToDevicePx(r.height)}px`,
        // Figma-style focus: dim everything OUTSIDE the scoped component so
        // its local rhythm is unmissable. One huge spread shadow = scrim
        // without an extra DOM node.
        boxShadow: "0 0 0 200vmax rgba(0, 0, 0, 0.35)",
      } satisfies Partial<CSSStyleDeclaration>);
    } else {
      Object.assign(el.style, {
        position: "absolute",
        inset: "0",
        left: "",
        top: "",
        width: "",
        height: "",
        boxShadow: "",
      } satisfies Partial<CSSStyleDeclaration>);
    }

    // Anchor the grid to the content container's top so the rhythm scrolls
    // WITH the document and row 0 starts where the content starts. A
    // viewport-fixed grid is only truthful at scroll position 0 — scrolled
    // pages would show lines that match nothing. The registry re-paints on
    // scroll, so this offset tracks continuously. (Scoped mode needs no
    // offset: the element's own box is the grid origin.)
    let offsetY = 0;
    if (!scope) {
      const anchorName = this.config.margins?.anchor;
      const anchorEl = anchorName
        ? specs.find((s) => s.label === anchorName)?.el
        : undefined;
      if (anchorEl) {
        const top = anchorEl.getBoundingClientRect().top;
        offsetY = ((top % step) + step) % step;
      }
    }
    const line = this.config.theme.baseline;
    const major = this.config.theme.baselineEmphasis;

    // Hairline width: 1 device pixel = 1/dpr CSS pixels. On retina (dpr=2)
    // this is 0.5px — a true single device pixel, matching native iOS dividers.
    // Without this, a 1 CSS px line spans 2 device pixels on retina and reads
    // as a heavy stripe rather than a subtle rhythm guide.
    const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
    const hair = 1 / dpr;

    const layers = [
      `repeating-linear-gradient(to bottom, ${line} 0, ${line} ${hair}px, transparent ${hair}px, transparent ${step}px)`,
    ];
    if (emphasizeEvery && emphasizeEvery > 0) {
      const majorStep = step * emphasizeEvery;
      layers.push(
        `repeating-linear-gradient(to bottom, ${major} 0, ${major} ${hair}px, transparent ${hair}px, transparent ${majorStep}px)`,
      );
    }
    Object.assign(el.style, {
      backgroundImage: layers.join(", "),
      // Snap the grid phase to the device-pixel grid: a fractional offset
      // (drag deltas, fractional rects) makes the sub-pixel hairlines
      // rasterize one device pixel off per repeat — lines stop looking
      // equidistant.
      backgroundPositionY: `${snapToDevicePx(offsetY + this.baselineOffset)}px`,
    } satisfies Partial<CSSStyleDeclaration>);
  }

  /**
   * Margins: tinted strips on left and right of the viewport or of each marked
   * element. Like Material Design / Apple HIG safe-area visualizations.
   */
  private paintMargins(visible: boolean, specs: ElementSpec[]): void {
    const el = this.marginsEl!;
    el.innerHTML = "";
    if (!visible) return;

    const color = this.config.theme.margin;
    const vw = window.innerWidth;

    // Project-wide margins (config.margins).
    if (this.config.margins) {
      const { anchor } = this.config.margins;
      // Anchor mode: find a matching `data-keyline="<anchor>"` element on the
      // current page. The registry's MutationObserver re-discovers anchors on
      // route changes — when the new page mounts its own `data-keyline="…"`
      // element, paint() will be re-scheduled and margins re-anchor naturally.
      if (anchor) {
        const anchored = specs.filter((s) => s.label === anchor);
        if (anchored.length > 0) {
          for (const spec of anchored) {
            const rect = spec.el.getBoundingClientRect();
            const width = parseOffset(this.config.margins.width, rect.width);
            // Suppress when margins would swallow the container. Below 40% of
            // the container, margins become meaningless ("you're seeing
            // padding, not a safe area"). The threshold is generous enough
            // to render correctly on phone viewports, strict enough to hide
            // nonsense when container is narrower than the design intends.
            if (width * 2 > rect.width * 0.6) continue;
            this.appendMarginStrip(el, rect.left, width, color);
            this.appendMarginStrip(
              el,
              rect.left + rect.width - width,
              width,
              color,
            );
          }
        } else {
          // Fallback: viewport edges. This way pages without the anchor still
          // get a visual cue rather than nothing.
          const width = parseOffset(this.config.margins.width, vw);
          this.appendMarginStrip(el, 0, width, color);
          this.appendMarginStrip(el, vw - width, width, color);
        }
      } else {
        // No anchor — viewport-edge mode.
        const width = parseOffset(this.config.margins.width, vw);
        this.appendMarginStrip(el, 0, width, color);
        this.appendMarginStrip(el, vw - width, width, color);
      }
    }

    // Per-element margin overrides via `data-keyline-margin` attribute.
    // Apple HIG / Material model: margins are the SAFE-AREA padding INSIDE the
    // container — the gutter between the container edge and where content
    // should sit. Tinted strips show this no-content zone visually.
    for (const spec of specs) {
      if (!spec.margin) continue;
      const rect = spec.el.getBoundingClientRect();
      const width = parseOffset(spec.margin, rect.width);
      const elementColor = spec.color ? this.tintFromColor(spec.color) : color;
      this.appendMarginStrip(el, rect.left, width, elementColor);
      this.appendMarginStrip(
        el,
        rect.left + rect.width - width,
        width,
        elementColor,
      );
    }
  }

  private appendMarginStrip(
    parent: HTMLDivElement,
    xPx: number,
    width: number,
    color: string,
  ): void {
    if (width <= 0) return;
    const strip = document.createElement("div");
    // Snap to device-pixel grid so edges stay crisp on retina displays.
    const x = snapToDevicePx(xPx);
    const w = snapToDevicePx(width);
    Object.assign(strip.style, {
      position: "absolute",
      top: "0",
      bottom: "0",
      left: `${x}px`,
      width: `${w}px`,
      background: color,
      pointerEvents: "none",
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(strip);
  }

  /** Derive a margin-strength tint from an explicit per-line color. */
  private tintFromColor(color: string): string {
    const rgba =
      /rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i.exec(color);
    if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, 0.16)`;
    return color;
  }

  /**
   * Positional lines from config.
   *
   * NOTE: edge keylines (the labeled lines at `data-keyline` element edges)
   * are intentionally NOT painted by default. Margins + columns already
   * communicate where the container sits, so edges added visual noise.
   * Only explicit positional `lines` from config still paint.
   *
   * The `data-keyline` attribute itself is still load-bearing: it's the
   * anchor mechanism for margins and columns. Removing the visual rendering
   * just declutters the overlay without changing the attribute's purpose.
   */
  private paintKeylines(visible: boolean): void {
    const el = this.keylinesEl!;
    el.innerHTML = "";
    if (!visible) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const defaultColor = this.config.theme.keyline;

    // Positional lines from config (the only thing keylines paints now).
    for (const line of this.config.lines) {
      const resolved = resolveLine(line, vw, vh);
      if (!resolved) continue;
      const color = resolved.color ?? defaultColor;
      this.appendEdgeLine(
        el,
        resolved.axis,
        resolved.anchor,
        resolved.px,
        color,
        resolved.label,
      );
    }
  }

  /**
   * Append one edge line. The line is a thin colored div with two attached
   * elements: a 6px dot signifier at the start, and a hidden label chip that
   * appears on hover (via CSS).
   */
  private appendEdgeLine(
    parent: HTMLDivElement,
    axis: "x" | "y",
    anchor: "left" | "right" | "top" | "bottom",
    px: number,
    color: string,
    label?: string,
  ): void {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-keyline-line", "");
    wrap.style.position = "absolute";
    wrap.style.pointerEvents = "none";

    // Line geometry. Snap to device-pixel grid for crisp hairlines on retina.
    const snapped = snapToDevicePx(px);
    if (axis === "x") {
      wrap.style.top = "0";
      wrap.style.bottom = "0";
      wrap.style.width = "1px";
      if (anchor === "right") wrap.style.right = `${snapped}px`;
      else wrap.style.left = `${snapped}px`;
    } else {
      wrap.style.left = "0";
      wrap.style.right = "0";
      wrap.style.height = "1px";
      if (anchor === "bottom") wrap.style.bottom = `${snapped}px`;
      else wrap.style.top = `${snapped}px`;
    }
    wrap.style.background = color;

    // Hit area (invisible, wider than line, captures hover).
    const hit = document.createElement("div");
    hit.setAttribute("data-keyline-hit", "");
    Object.assign(hit.style, {
      position: "absolute",
      pointerEvents: "auto",
      ...(axis === "x"
        ? { top: "0", bottom: "0", left: "-8px", width: "17px" }
        : { left: "0", right: "0", top: "-8px", height: "17px" }),
    } satisfies Partial<CSSStyleDeclaration>);
    wrap.appendChild(hit);

    // Dot signifier — always-visible discoverability hint.
    const dot = document.createElement("div");
    dot.setAttribute("data-keyline-dot", "");
    Object.assign(dot.style, {
      position: "absolute",
      width: "6px",
      height: "6px",
      borderRadius: "999px",
      background: color,
      ...(axis === "x"
        ? { top: "6px", left: "-2.5px" }
        : { left: "6px", top: "-2.5px" }),
    } satisfies Partial<CSSStyleDeclaration>);
    wrap.appendChild(dot);

    // Label chip — hidden by default, revealed on hover via CSS rule.
    if (label) {
      const chip = document.createElement("span");
      chip.setAttribute("data-keyline-label", "");
      chip.setAttribute("data-side", anchor);
      chip.textContent = label;
      Object.assign(chip.style, {
        position: "absolute",
        font: "10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace",
        color: this.config.theme.label,
        background: this.config.theme.labelBackground,
        padding: "1px 4px",
        borderRadius: "2px",
        whiteSpace: "nowrap",
        letterSpacing: "0.02em",
        mixBlendMode: "normal",
        ...(axis === "x"
          ? anchor === "right"
            ? { right: "6px", top: "16px" }
            : { left: "6px", top: "16px" }
          : anchor === "bottom"
            ? { left: "16px", bottom: "6px" }
            : { left: "16px", top: "6px" }),
      } satisfies Partial<CSSStyleDeclaration>);
      wrap.appendChild(chip);
    }

    parent.appendChild(wrap);
  }

  /** Public paint entry — called by registry on every schedule tick. */
  paint(state: KeylineState, specs: ElementSpec[]): void {
    this.ensureRoot();
    // Always paint families so they fade in/out with their visibility flags
    // (rather than appearing/disappearing instantly). The overlay root itself
    // also fades when `enabled` toggles.
    this.root!.setAttribute("data-enabled", state.enabled ? "true" : "false");
    this.paintMargins(state.visibility.margins, specs);
    this.paintColumns(state.visibility.columns, specs);
    this.paintBaseline(state.visibility.baseline, specs);
    this.paintKeylines(state.visibility.keylines);
    this.marginsEl!.setAttribute(
      "data-visible",
      String(state.visibility.margins),
    );
    this.columnsEl!.setAttribute(
      "data-visible",
      String(state.visibility.columns),
    );
    this.baselineEl!.setAttribute(
      "data-visible",
      String(state.visibility.baseline),
    );
    this.keylinesEl!.setAttribute(
      "data-visible",
      String(state.visibility.keylines),
    );
  }

  destroy(): void {
    this.root?.remove();
    this.style?.remove();
    this.root = null;
    this.style = null;
    this.marginsEl = null;
    this.columnsEl = null;
    this.baselineEl = null;
    this.keylinesEl = null;
  }
}

/**
 * Snap a CSS-pixel value to the device-pixel grid so hairlines stay crisp on
 * retina displays. On 1x, returns the integer. On 2x, returns x.0 or x.5
 * (whichever is nearest). Same on 3x.
 *
 * Why this matters: a 1px-wide div at `left: 244.7px` on a 2x display would
 * anti-alias across two device pixels, fading the line into a 2-px blur.
 * Snapping makes the device-pixel edge land exactly on a column boundary.
 */
function snapToDevicePx(value: number): number {
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  return Math.round(value * dpr) / dpr;
}

/**
 * Stylesheet — tactile motion language.
 *
 * Easing tokens (scoped to the overlay so they can't leak):
 *   --kl-spring:  cubic-bezier(0.34, 1.56, 0.64, 1)   slight overshoot, used for elements appearing
 *   --kl-out:     cubic-bezier(0.16, 1, 0.3, 1)        fast start, smooth settle — Apple/Material curve
 *   --kl-inout:   cubic-bezier(0.4, 0, 0.2, 1)         symmetric ease for state changes
 *
 * Durations:
 *   --kl-fast:    80ms      micro feedback
 *   --kl-base:    180ms     element appear/disappear
 *   --kl-slow:    280ms     overlay show/hide, big state shifts
 *
 * Reduced motion: kills transitions (state changes are instant); preserves
 * opacity fades because instant opacity flicker is visually harsher.
 * Print: overlay hidden.
 */
const STYLES = `
[data-keyline-overlay] {
  --kl-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  --kl-out: cubic-bezier(0.16, 1, 0.3, 1);
  --kl-inout: cubic-bezier(0.4, 0, 0.2, 1);
  --kl-fast: 80ms;
  --kl-base: 180ms;
  --kl-slow: 280ms;

  opacity: 0;
  transition: opacity var(--kl-slow) var(--kl-out);
}
[data-keyline-overlay][data-enabled="true"] {
  opacity: 1;
}

[data-keyline-overlay] > div {
  opacity: 0;
  transition: opacity var(--kl-base) var(--kl-out);
}
[data-keyline-overlay] > div[data-visible="true"] {
  opacity: 1;
}

/* Enable choreography: the page blueprints itself. Columns draw top-down,
   the baseline cascades just behind, margins and declared lines fade in
   last. Re-runs each time the overlay (or a family) turns on. */
@keyframes kl-draw-down {
  from { clip-path: inset(0 0 100% 0); }
  to   { clip-path: inset(0 0 0 0); }
}
@keyframes kl-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
/* Layer order: 1 margins, 2 columns, 3 baseline, 4 keylines. */
[data-keyline-overlay][data-enabled="true"] > div[data-visible="true"]:nth-child(2) {
  animation: kl-draw-down 420ms var(--kl-out) both;
}
[data-keyline-overlay][data-enabled="true"] > div[data-visible="true"]:nth-child(3) {
  animation: kl-draw-down 520ms var(--kl-out) 100ms both;
}
[data-keyline-overlay][data-enabled="true"] > div[data-visible="true"]:nth-child(1) {
  animation: kl-draw-down 420ms var(--kl-out) 220ms both;
}
[data-keyline-overlay][data-enabled="true"] > div[data-visible="true"]:nth-child(4) {
  animation: kl-fade-in 240ms var(--kl-out) 380ms both;
}

/* Edge keyline wrapper — slight scaleX bump on hide, so lines visually
   "retract" toward their anchor edge rather than disappearing in place. */
[data-keyline-overlay] [data-keyline-line] {
  transition: opacity var(--kl-base) var(--kl-out);
}

/* Always-visible dot signifier — calm baseline, alive on hover. */
[data-keyline-overlay] [data-keyline-dot] {
  opacity: 0.65;
  transform: scale(1);
  transform-origin: center;
  transition:
    transform var(--kl-base) var(--kl-spring),
    opacity var(--kl-base) var(--kl-out);
}
[data-keyline-overlay] [data-keyline-line]:hover [data-keyline-dot],
[data-keyline-overlay] [data-keyline-line]:focus-within [data-keyline-dot] {
  opacity: 1;
  transform: scale(1.8);
}

/* When overlay is enabled, the dot breathes very subtly to signal "alive"
   without being distracting. ~3s cycle, ±0.15 opacity. Killed on hover. */
@keyframes keyline-breathe {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 0.8; }
}
[data-keyline-overlay][data-enabled="true"] [data-keyline-dot] {
  animation: keyline-breathe 3s var(--kl-inout) infinite;
}
[data-keyline-overlay] [data-keyline-line]:hover [data-keyline-dot] {
  animation: none;
}

/* Label chip: hidden by default; on line-hover slides in from the line side
   with a slight spring. Direction depends on line anchor. */
[data-keyline-overlay] [data-keyline-label] {
  opacity: 0;
  transform: translateX(-6px);
  transition:
    opacity var(--kl-base) var(--kl-out),
    transform var(--kl-base) var(--kl-spring);
  pointer-events: none;
}
[data-keyline-overlay] [data-keyline-line]:hover [data-keyline-label],
[data-keyline-overlay] [data-keyline-line]:focus-within [data-keyline-label] {
  opacity: 1;
  transform: translateX(0);
}
/* Right-anchored labels slide in from the opposite side. */
[data-keyline-overlay] [data-keyline-line] [data-keyline-label][data-side="right"] {
  transform: translateX(6px);
}
[data-keyline-overlay] [data-keyline-line]:hover [data-keyline-label][data-side="right"],
[data-keyline-overlay] [data-keyline-line]:focus-within [data-keyline-label][data-side="right"] {
  transform: translateX(0);
}

@media (prefers-reduced-motion: reduce) {
  [data-keyline-overlay],
  [data-keyline-overlay] *,
  [data-keyline-overlay] *::before,
  [data-keyline-overlay] *::after {
    animation: none !important;
    transition: opacity var(--kl-fast) linear !important;
    transform: none !important;
  }
}

@media print {
  [data-keyline-overlay] { display: none !important; }
}
`;
