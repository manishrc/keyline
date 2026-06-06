import { parseOffset, resolveLine } from "../config.js";
import type { ResolvedConfig } from "../types.js";
import { cssEscape } from "./dom.js";

/**
 * Resolved grid geometry — the actual pixel positions of every guide the
 * config produces at the current viewport. Single source of truth shared by
 * the inspector (distance readouts), snapshot() (agent surface), and the
 * rulers' snap targets.
 *
 * Mirrors the renderer's math (margins-anchored "Figma frame" model):
 * columns inset inside the margins of the anchored element when
 * `margins.anchor` matches a mounted `data-keyline` element; viewport
 * fallback otherwise.
 */
export interface GridGeometry {
  /** X positions of every column edge (left and right of each column). */
  columnEdges: number[];
  /** Y positions of baseline lines currently in the viewport. */
  baselineLines: number[];
  /** X positions of margin strip inner/outer edges. */
  marginEdges: number[];
  /** Declared positional lines resolved to viewport px. */
  declaredLines: { axis: "x" | "y"; pos: number; label?: string }[];
  /** The anchored container rect, if an anchor element is mounted. */
  containerRect: DOMRect | null;
}

export function computeGeometry(
  config: ResolvedConfig,
  baselineScope?: HTMLElement | null,
  baselineOffset = 0,
): GridGeometry {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const anchorEl = config.margins?.anchor
    ? document.querySelector<HTMLElement>(
        `[data-keyline="${cssEscape(config.margins.anchor)}"]`,
      )
    : null;
  const containerRect = anchorEl ? anchorEl.getBoundingClientRect() : null;

  const marginEdges: number[] = [];
  let bandLeft: number | null = null;
  let bandWidth: number | null = null;

  if (config.margins) {
    if (containerRect) {
      const w = parseOffset(config.margins.width, containerRect.width);
      marginEdges.push(
        containerRect.left,
        containerRect.left + w,
        containerRect.right - w,
        containerRect.right,
      );
      bandLeft = containerRect.left + w;
      bandWidth = containerRect.width - w * 2;
    } else {
      const w = parseOffset(config.margins.width, vw);
      marginEdges.push(0, w, vw - w, vw);
    }
  }

  const columnEdges: number[] = [];
  if (config.columns) {
    const { count, gutter, margin, maxWidth } = config.columns;
    if (bandLeft === null || bandWidth === null) {
      bandWidth = maxWidth
        ? Math.min(maxWidth, vw - margin * 2)
        : vw - margin * 2;
      bandLeft = maxWidth ? Math.max(margin, (vw - bandWidth) / 2) : margin;
    }
    if (bandWidth > count) {
      const totalGutter = gutter * (count - 1);
      const colWidth = (bandWidth - totalGutter) / count;
      for (let i = 0; i < count; i++) {
        const left = bandLeft + i * (colWidth + gutter);
        columnEdges.push(left, left + colWidth);
      }
    }
  }

  // Baseline anchored to the container top (mirrors the renderer): the grid
  // scrolls with the document, row 0 = content top. When a hold-B-click
  // scope is active, the grid belongs to that element instead — lines exist
  // only within its bounds, row 0 at its top.
  const baselineLines: number[] = [];
  if (config.baseline) {
    const step = config.baseline.step;
    if (baselineScope?.isConnected) {
      const r = baselineScope.getBoundingClientRect();
      for (
        let y = r.top + baselineOffset;
        y <= Math.min(r.bottom, vh);
        y += step
      )
        baselineLines.push(y);
    } else {
      const anchor = containerRect
        ? ((containerRect.top % step) + step) % step
        : 0;
      const start = (((anchor + baselineOffset) % step) + step) % step;
      for (let y = start; y <= vh; y += step) baselineLines.push(y);
    }
  }

  const declaredLines: GridGeometry["declaredLines"] = [];
  for (const line of config.lines) {
    const resolved = resolveLine(line, vw, vh);
    if (!resolved) continue;
    const pos =
      resolved.anchor === "right"
        ? vw - resolved.px
        : resolved.anchor === "bottom"
          ? vh - resolved.px
          : resolved.px;
    declaredLines.push({ axis: resolved.axis, pos, label: resolved.label });
  }

  return {
    columnEdges,
    baselineLines,
    marginEdges,
    declaredLines,
    containerRect,
  };
}

/**
 * Nearest grid feature to a position on an axis. Used by the inspector to
 * label "3px off column 4" readouts.
 */
export interface NearestResult {
  kind: "column" | "baseline" | "margin" | "line";
  pos: number;
  delta: number;
}

export function nearestOnAxis(
  geometry: GridGeometry,
  axis: "x" | "y",
  value: number,
): NearestResult | null {
  let best: NearestResult | null = null;
  const consider = (kind: NearestResult["kind"], pos: number) => {
    const delta = value - pos;
    if (!best || Math.abs(delta) < Math.abs(best.delta))
      best = { kind, pos, delta };
  };
  if (axis === "x") {
    for (const p of geometry.columnEdges) consider("column", p);
    for (const p of geometry.marginEdges) consider("margin", p);
    for (const l of geometry.declaredLines)
      if (l.axis === "x") consider("line", l.pos);
  } else {
    for (const p of geometry.baselineLines) consider("baseline", p);
    for (const l of geometry.declaredLines)
      if (l.axis === "y") consider("line", l.pos);
  }
  return best;
}
