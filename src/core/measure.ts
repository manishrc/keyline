/**
 * Pure measurement math for the inspector. Pixel geometry only — no DOM.
 */

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface InsetDistances {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Distances from a child's edges to its parent's edges — the effective
 * inset/padding. Negative when the child overflows the parent.
 */
export function insetDistances(child: Rect, parent: Rect): InsetDistances {
  return {
    top: child.top - parent.top,
    right: parent.right - child.right,
    bottom: parent.bottom - child.bottom,
    left: child.left - parent.left,
  };
}

export interface GapResult {
  axis: "x" | "y";
  gap: number;
}

/**
 * Edge-to-edge distance between two rects, on the axis where they're
 * actually separated. Overlapping rects → gap 0. Separated on both axes
 * (diagonal) → the axis with the LARGER gap (that's the one the eye reads
 * as "the spacing between these two").
 */
export function gapBetween(a: Rect, b: Rect): GapResult {
  const xGap = Math.max(b.left - a.right, a.left - b.right, 0);
  const yGap = Math.max(b.top - a.bottom, a.top - b.bottom, 0);
  if (xGap === 0 && yGap === 0) return { axis: "y", gap: 0 };
  return yGap >= xGap ? { axis: "y", gap: yGap } : { axis: "x", gap: xGap };
}

/**
 * Is a gap/inset on the spacing scale? Default scale = multiples of the
 * baseline step. Tolerates ±0.5px of subpixel rendering noise.
 */
export function isOnScale(
  value: number,
  step: number,
  tolerance = 0.5,
): boolean {
  if (step <= 0) return true;
  const remainder = Math.abs(value % step);
  return remainder <= tolerance || step - remainder <= tolerance;
}
