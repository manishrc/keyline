import { parseOffset } from "../config.js";
import type { ResolvedConfig } from "../types.js";
import { cssEscape, injectStylesOnce } from "./dom.js";
import { computeGeometry } from "./geometry.js";
import type { GuideAxis, LocalGuide, LocalGuideStore } from "./local-guides.js";
import type { KeylineStore } from "./store.js";

/**
 * Rulers + local guides — the drag-to-measure surface.
 *
 * Two ruler bars (top, left). Drag from a ruler onto the page to drop a
 * local guide. Existing guides can be dragged to reposition; drag back to
 * the ruler (or press Delete while hovered) to remove. Guides snap to the
 * declared layout (columns / margins / baseline / declared lines) within
 * `snapDistance` CSS px. Shift overrides snap (free-form).
 *
 * The rulers + guides live in their own root, separate from the main
 * overlay, so they can be `pointer-events:auto` (interactive) without
 * affecting the renderer's `pointer-events:none` overlay layer.
 *
 * Visibility:
 *  - When overlay enabled AND `state.visibility.rulers` true → rulers visible.
 *  - Guides are visible whenever the overlay is enabled (they're persistent
 *    measurements; hiding the rulers just removes the creation surface).
 */
export interface RulerSurface {
  destroy: () => void;
}

export interface RulerOptions {
  config: ResolvedConfig;
  store: KeylineStore;
  localGuides: LocalGuideStore;
  /** Used to schedule a repaint of the overlay when guides change layout. */
  schedule: () => void;
}

const RULER_THICKNESS = 18; // CSS px

const STYLES = `
[data-keyline-rulers] {
  --kr-out: cubic-bezier(0.16, 1, 0.3, 1);
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483645; /* below inspector readouts and the floating button */
  opacity: 0;
  transition: opacity 240ms var(--kr-out);
}
[data-keyline-rulers][data-enabled="true"] {
  opacity: 1;
}
[data-keyline-rulers] [data-kr-bar] {
  position: absolute;
  background: rgba(0, 0, 0, 0.8);
  color: rgba(255, 255, 255, 0.85);
  font: 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
  overflow: hidden;
  transition: opacity 200ms var(--kr-out), transform 280ms var(--kr-out);
}
/* Rulers slide in from their edge when shown. */
[data-keyline-rulers][data-rulers-visible="false"] [data-kr-bar="top"] { transform: translateY(-100%); }
[data-keyline-rulers][data-rulers-visible="false"] [data-kr-bar="left"] { transform: translateX(-100%); }
[data-keyline-rulers][data-rulers-visible="false"] [data-kr-corner] { transform: translate(-100%, -100%); }
[data-keyline-rulers] [data-kr-corner] { transition: opacity 200ms var(--kr-out), transform 280ms var(--kr-out); }
[data-keyline-rulers][data-rulers-visible="false"] [data-kr-corner] { opacity: 0; pointer-events: none; }
[data-keyline-rulers][data-rulers-visible="false"] [data-kr-bar] { opacity: 0; pointer-events: none; }
[data-keyline-rulers][data-rulers-visible="true"] [data-kr-bar] { opacity: 1; }
/* Cursor telegraphs the drag axis: the top ruler creates a HORIZONTAL line
   you drag vertically (ns), the left ruler creates a VERTICAL line you drag
   horizontally (ew). Matches Figma/Sketch ruler affordances. */
[data-keyline-rulers] [data-kr-bar="top"] {
  top: 0; left: 0; right: 0; height: ${RULER_THICKNESS}px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  cursor: ns-resize;
}
[data-keyline-rulers] [data-kr-bar="left"] {
  top: 0; left: 0; bottom: 0; width: ${RULER_THICKNESS}px;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  cursor: ew-resize;
}
/* Two contrast levels only — equal-contrast ticks read as noise. */
[data-keyline-rulers] [data-kr-tick] {
  position: absolute;
  background: rgba(255, 255, 255, 0.15);
}
[data-keyline-rulers] [data-kr-tick][data-major] {
  background: rgba(255, 255, 255, 0.35);
}
[data-keyline-rulers] [data-kr-label] {
  position: absolute;
  font-size: 8px;
  color: rgba(255, 255, 255, 0.5);
}
/* Vertical ruler is only ${RULER_THICKNESS}px wide — rotate labels to read
   bottom-up along the bar, like Figma/Sketch. */
[data-keyline-rulers] [data-kr-bar="left"] [data-kr-label] {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
}
[data-keyline-rulers] [data-kr-corner] {
  position: absolute;
  top: 0; left: 0;
  width: ${RULER_THICKNESS}px;
  height: ${RULER_THICKNESS}px;
  background: rgba(0, 0, 0, 0.8);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: rgba(255, 255, 255, 0.45);
}
/* Destructive action shouldn't hide behind a dot — reveal the ✕ on hover. */
[data-keyline-rulers] [data-kr-corner]::before { content: "·"; }
[data-keyline-rulers] [data-kr-corner]:hover::before { content: "✕"; font-size: 9px; }
[data-keyline-rulers] [data-kr-corner]:hover {
  color: rgba(255, 255, 255, 0.95);
  background: rgba(255, 255, 255, 0.08);
}
[data-keyline-rulers] [data-kr-corner]:active::before { transform: scale(0.9); }

/* Guides. Dashed style to distinguish from declared lines. */
[data-keyline-rulers] [data-kr-guide] {
  position: absolute;
  pointer-events: auto;
  background: transparent;
  transition: opacity 140ms var(--kr-out), transform 140ms var(--kr-out);
}
[data-keyline-rulers] [data-kr-guide][data-axis="x"] {
  top: 0; bottom: 0;
  width: 13px;
  margin-left: -6px;
  cursor: col-resize;
}
[data-keyline-rulers] [data-kr-guide][data-axis="y"] {
  left: 0; right: 0;
  height: 13px;
  margin-top: -6px;
  cursor: row-resize;
}
[data-keyline-rulers] [data-kr-guide] [data-kr-line] {
  position: absolute;
  transition: border-color 120ms var(--kr-out), box-shadow 120ms var(--kr-out);
}
[data-keyline-rulers] [data-kr-guide][data-axis="x"] [data-kr-line] {
  top: 0; bottom: 0; left: 6px; width: 1px;
  border-left: 1px dashed rgba(56, 189, 248, 0.85);
}
[data-keyline-rulers] [data-kr-guide][data-axis="y"] [data-kr-line] {
  left: 0; right: 0; top: 6px; height: 1px;
  border-top: 1px dashed rgba(56, 189, 248, 0.85);
}
[data-keyline-rulers] [data-kr-guide]:hover [data-kr-line] {
  border-color: rgba(56, 189, 248, 1);
  box-shadow: 0 0 4px rgba(56, 189, 248, 0.5);
}
/* Dragging toward the ruler = about to delete: squish + dim, recoverable. */
[data-keyline-rulers] [data-kr-guide][data-kr-deleting] {
  opacity: 0.35;
}
[data-keyline-rulers] [data-kr-guide][data-kr-deleting][data-axis="x"] { transform: scaleX(0.6); }
[data-keyline-rulers] [data-kr-guide][data-kr-deleting][data-axis="y"] { transform: scaleY(0.6); }

/* Drag-in-progress preview guide (still being placed) */
[data-keyline-rulers] [data-kr-draft] {
  position: absolute;
  pointer-events: none;
}
[data-keyline-rulers] [data-kr-draft][data-axis="x"] {
  top: 0; bottom: 0; width: 1px;
  border-left: 1px dashed rgba(56, 189, 248, 0.85);
}
[data-keyline-rulers] [data-kr-draft][data-axis="y"] {
  left: 0; right: 0; height: 1px;
  border-top: 1px dashed rgba(56, 189, 248, 0.85);
}
[data-keyline-rulers] [data-kr-snapped="true"] {
  filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.8));
}

/* Tag chip — coordinate readout near the cursor while dragging, with a
   mid-gesture hint line teaching the hidden verbs. */
[data-keyline-rulers] [data-kr-tag] {
  position: absolute;
  padding: 3px 7px;
  background: rgba(0, 0, 0, 0.85);
  color: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
  font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  pointer-events: none;
  white-space: nowrap;
}
[data-keyline-rulers] [data-kr-tag] [data-kr-hint] {
  display: block;
  margin-top: 2px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.45);
}

@media (prefers-reduced-motion: reduce) {
  [data-keyline-rulers], [data-keyline-rulers] * {
    transition: opacity 80ms linear !important;
  }
}
@media print { [data-keyline-rulers] { display: none !important; } }
`;

export function mountRulers(opts: RulerOptions): RulerSurface {
  if (typeof document === "undefined") return { destroy: () => {} };
  injectStylesOnce("data-keyline-rulers-style", STYLES);

  const { config, store, localGuides, schedule } = opts;
  const snapDistance = config.rulers?.snapDistance ?? 6;

  const root = document.createElement("div");
  root.setAttribute("data-keyline-rulers", "");
  root.setAttribute("aria-hidden", "true");

  const topBar = document.createElement("div");
  topBar.setAttribute("data-kr-bar", "top");
  const leftBar = document.createElement("div");
  leftBar.setAttribute("data-kr-bar", "left");
  const corner = document.createElement("div");
  corner.setAttribute("data-kr-corner", "");
  corner.title = "Clear local guides on this page";

  root.appendChild(topBar);
  root.appendChild(leftBar);
  root.appendChild(corner);

  const guidesLayer = document.createElement("div");
  guidesLayer.style.position = "absolute";
  guidesLayer.style.inset = "0";
  guidesLayer.style.pointerEvents = "none";
  root.appendChild(guidesLayer);

  document.body.appendChild(root);

  // Render tick marks on both rulers. Major every 100, minor every 10.
  paintRulerTicks(topBar, "horizontal");
  paintRulerTicks(leftBar, "vertical");
  const onResize = () => {
    paintRulerTicks(topBar, "horizontal");
    paintRulerTicks(leftBar, "vertical");
  };
  window.addEventListener("resize", onResize);

  // --- State + render --------------------------------------------------
  const sync = () => {
    const state = store.get();
    root.setAttribute("data-enabled", state.enabled ? "true" : "false");
    root.setAttribute(
      "data-rulers-visible",
      state.enabled && state.visibility.rulers ? "true" : "false",
    );
    paintGuides();
  };

  const guideEls = new Map<string, HTMLDivElement>();

  const paintGuides = () => {
    const guides = localGuides.list();
    const liveIds = new Set(guides.map((g) => g.id));
    for (const [id, el] of guideEls) {
      if (!liveIds.has(id)) {
        el.remove();
        guideEls.delete(id);
      }
    }
    for (const guide of guides) {
      let el = guideEls.get(guide.id);
      if (!el) {
        el = document.createElement("div");
        el.setAttribute("data-kr-guide", "");
        el.setAttribute("data-axis", guide.axis);
        const line = document.createElement("div");
        line.setAttribute("data-kr-line", "");
        el.appendChild(line);
        attachGuideDrag(el, guide.id);
        guidesLayer.appendChild(el);
        guideEls.set(guide.id, el);
      }
      placeGuide(el, guide);
    }
  };

  const placeGuide = (el: HTMLDivElement, guide: LocalGuide) => {
    if (guide.axis === "x") {
      el.style.left = `${guide.pos}px`;
      el.style.top = "";
    } else {
      el.style.top = `${guide.pos}px`;
      el.style.left = "";
    }
  };

  // --- Draft drag (creating new guide from ruler) ----------------------
  let draftEl: HTMLDivElement | null = null;
  let draftTagEl: HTMLDivElement | null = null;

  const beginDraft = (axis: GuideAxis) => {
    if (draftEl) draftEl.remove();
    if (draftTagEl) draftTagEl.remove();
    draftEl = document.createElement("div");
    draftEl.setAttribute("data-kr-draft", "");
    draftEl.setAttribute("data-axis", axis);
    root.appendChild(draftEl);
    draftTagEl = document.createElement("div");
    draftTagEl.setAttribute("data-kr-tag", "");
    root.appendChild(draftTagEl);
  };

  const setTag = (tag: HTMLDivElement, value: string, hint: string) => {
    tag.textContent = value;
    const h = document.createElement("span");
    h.setAttribute("data-kr-hint", "");
    h.textContent = hint;
    tag.appendChild(h);
  };

  const placeDraft = (axis: GuideAxis, pos: number, snapped: boolean) => {
    if (!draftEl || !draftTagEl) return;
    draftEl.setAttribute("data-kr-snapped", snapped ? "true" : "false");
    setTag(draftTagEl, `${Math.round(pos)}`, "hold shift to skip snapping");
    if (axis === "x") {
      draftEl.style.left = `${pos}px`;
      draftTagEl.style.left = `${pos + 6}px`;
      draftTagEl.style.top = `${RULER_THICKNESS + 6}px`;
    } else {
      draftEl.style.top = `${pos}px`;
      draftTagEl.style.top = `${pos + 6}px`;
      draftTagEl.style.left = `${RULER_THICKNESS + 6}px`;
    }
  };

  const endDraft = (commit: boolean, axis: GuideAxis, pos: number) => {
    if (draftEl) {
      draftEl.remove();
      draftEl = null;
    }
    if (draftTagEl) {
      draftTagEl.remove();
      draftTagEl = null;
    }
    if (commit && pos > RULER_THICKNESS) {
      localGuides.add(axis, pos);
      schedule();
    }
  };

  const onRulerPointerDown = (axis: GuideAxis) => (e: PointerEvent) => {
    if (!store.get().enabled || !store.get().visibility.rulers) return;
    e.preventDefault();
    beginDraft(axis);
    // currentTarget is nulled once dispatch ends — capture it for the async
    // pointerup handler.
    const bar = e.currentTarget as HTMLElement;
    try {
      bar.setPointerCapture(e.pointerId);
    } catch {
      /* stale/synthetic pointerId */
    }
    let lastPos = axis === "x" ? e.clientX : e.clientY;

    const move = (me: PointerEvent) => {
      const raw = axis === "x" ? me.clientX : me.clientY;
      const target = axis === "x" ? me.clientY : me.clientX;
      // While the pointer is still inside the bar (the OTHER axis is < RULER_THICKNESS),
      // hold the draft just inside the page so the user sees something appear.
      const min = RULER_THICKNESS + 1;
      const initial = Math.max(min, raw);
      const onPage = target > RULER_THICKNESS;
      const { pos, didSnap } =
        onPage && !me.shiftKey
          ? snapToTargets(
              axis,
              initial,
              snapDistance,
              config,
              localGuides,
              undefined,
            )
          : { pos: initial, didSnap: false };
      lastPos = pos;
      placeDraft(axis, pos, didSnap);
    };
    const up = (ue: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      try {
        bar.releasePointerCapture(e.pointerId);
      } catch {
        /* stale/synthetic pointerId */
      }
      const target = axis === "x" ? ue.clientY : ue.clientX;
      const dropOnPage = target > RULER_THICKNESS && lastPos > RULER_THICKNESS;
      endDraft(dropOnPage, axis, lastPos);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  topBar.addEventListener("pointerdown", onRulerPointerDown("y"));
  leftBar.addEventListener("pointerdown", onRulerPointerDown("x"));

  // --- Existing-guide drag ---------------------------------------------
  function attachGuideDrag(el: HTMLDivElement, guideId: string): void {
    el.addEventListener("pointerdown", (e) => {
      if (!store.get().enabled) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* stale/synthetic pointerId */
      }
      const liveAxis = el.getAttribute("data-axis") as GuideAxis;
      const line = el.querySelector<HTMLElement>("[data-kr-line]");

      // Alt-drag duplicates (Figma): leave a copy behind at the current
      // position and keep dragging this guide.
      const startGuide = localGuides.list().find((g) => g.id === guideId);
      if (e.altKey && startGuide) localGuides.add(liveAxis, startGuide.pos);

      const tag = document.createElement("div");
      tag.setAttribute("data-kr-tag", "");
      root.appendChild(tag);
      let wasSnapped = false;

      const move = (me: PointerEvent) => {
        const raw = liveAxis === "x" ? me.clientX : me.clientY;
        const target = liveAxis === "x" ? me.clientY : me.clientX;
        el.toggleAttribute("data-kr-deleting", target <= RULER_THICKNESS);
        const min = RULER_THICKNESS + 1;
        const initial = Math.max(min, raw);
        const { pos, didSnap } = me.shiftKey
          ? { pos: initial, didSnap: false }
          : snapToTargets(
              liveAxis,
              initial,
              snapDistance,
              config,
              localGuides,
              guideId,
            );
        if (liveAxis === "x") el.style.left = `${pos}px`;
        else el.style.top = `${pos}px`;
        el.toggleAttribute("data-kr-snapped", didSnap);
        // Haptic-for-the-eyes: a 1px wiggle when the guide catches a target.
        if (didSnap && !wasSnapped && line) {
          const t = liveAxis === "x" ? "translateX" : "translateY";
          line.animate(
            [
              { transform: `${t}(0)` },
              { transform: `${t}(1.5px)` },
              { transform: `${t}(-1px)` },
              { transform: `${t}(0)` },
            ],
            { duration: 160, easing: "ease-out" },
          );
        }
        wasSnapped = didSnap;
        setTag(
          tag,
          `${Math.round(pos)}`,
          target <= RULER_THICKNESS
            ? "release to delete"
            : "drag onto ruler to delete",
        );
        tag.style.left = `${me.clientX + 10}px`;
        tag.style.top = `${me.clientY + 12}px`;
      };
      const up = (ue: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        try {
          el.releasePointerCapture(e.pointerId);
        } catch {
          /* stale/synthetic pointerId */
        }
        tag.remove();
        el.removeAttribute("data-kr-deleting");
        const target = liveAxis === "x" ? ue.clientY : ue.clientX;
        if (target <= RULER_THICKNESS) {
          localGuides.remove(guideId);
        } else {
          const raw = liveAxis === "x" ? ue.clientX : ue.clientY;
          const min = RULER_THICKNESS + 1;
          const initial = Math.max(min, raw);
          const snapResult: { pos: number; didSnap: boolean } = ue.shiftKey
            ? { pos: initial, didSnap: false }
            : snapToTargets(
                liveAxis,
                initial,
                snapDistance,
                config,
                localGuides,
                guideId,
              );
          localGuides.move(guideId, snapResult.pos);
        }
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    });
    el.addEventListener("dblclick", () => {
      localGuides.remove(guideId);
    });
  }

  // Clear-all on corner click.
  corner.addEventListener("click", () => {
    if (!store.get().enabled) return;
    if (localGuides.list().length === 0) return;
    localGuides.clear();
    schedule();
  });

  const unsubscribeStore = store.subscribe(() => sync());
  const unsubscribeGuides = localGuides.subscribe(() => {
    paintGuides();
    schedule();
  });

  // Initial paint.
  sync();

  return {
    destroy: () => {
      window.removeEventListener("resize", onResize);
      unsubscribeStore();
      unsubscribeGuides();
      root.remove();
      localGuides.destroy();
    },
  };
}

/**
 * Render tick marks on a ruler bar so the user has a visual scale reference.
 * Major ticks every 100px, minor every 10px. We re-paint on resize via the
 * caller's render path (rulers get a sync() per store update; resize emits
 * one through the renderer's schedule already).
 */
function paintRulerTicks(
  bar: HTMLDivElement,
  axis: "horizontal" | "vertical",
): void {
  bar.innerHTML = "";
  const length = axis === "horizontal" ? window.innerWidth : window.innerHeight;
  for (let p = 0; p <= length; p += 10) {
    const major = p % 100 === 0;
    const tick = document.createElement("div");
    tick.setAttribute("data-kr-tick", "");
    if (major) tick.setAttribute("data-major", "");
    if (axis === "horizontal") {
      tick.style.left = `${p}px`;
      tick.style.bottom = "0";
      tick.style.width = "1px";
      tick.style.height = major ? "10px" : "5px";
    } else {
      tick.style.top = `${p}px`;
      tick.style.right = "0";
      tick.style.height = "1px";
      tick.style.width = major ? "10px" : "5px";
    }
    bar.appendChild(tick);
    if (major && p > 0) {
      const label = document.createElement("div");
      label.setAttribute("data-kr-label", "");
      label.textContent = String(p);
      if (axis === "horizontal") {
        label.style.left = `${p + 2}px`;
        label.style.top = "2px";
      } else {
        label.style.top = `${p + 2}px`;
        label.style.left = "2px";
      }
      bar.appendChild(label);
    }
  }
}

/**
 * Snap an in-flight drag position to the nearest layout target.
 *
 * Targets:
 *  - Each declared positional line.
 *  - Each column edge (computed against margins-anchor or viewport fallback).
 *  - Each margin strip edge.
 *  - Each baseline (within snapDistance only — many candidates).
 *  - Each other local guide (so guides snap to each other).
 *
 * Returns the snapped position and whether snap actually happened.
 */
function snapToTargets(
  axis: GuideAxis,
  pos: number,
  snapDistance: number,
  config: ResolvedConfig,
  localGuides: LocalGuideStore,
  ignoreId: string | undefined,
): { pos: number; didSnap: boolean } {
  const candidates = collectSnapCandidates(axis, config, localGuides, ignoreId);
  let best: { dist: number; pos: number } | null = null;
  for (const c of candidates) {
    const d = Math.abs(c - pos);
    if (d <= snapDistance && (!best || d < best.dist)) {
      best = { dist: d, pos: c };
    }
  }
  return best ? { pos: best.pos, didSnap: true } : { pos, didSnap: false };
}

function collectSnapCandidates(
  axis: GuideAxis,
  config: ResolvedConfig,
  localGuides: LocalGuideStore,
  ignoreId: string | undefined,
): number[] {
  const out: number[] = [];
  const vh = window.innerHeight;
  const geometry = computeGeometry(config);

  for (const g of localGuides.list()) {
    if (g.id === ignoreId) continue;
    if (g.axis === axis) out.push(g.pos);
  }

  for (const l of geometry.declaredLines) {
    if (l.axis === axis) out.push(l.pos);
  }

  if (axis === "x") {
    for (const p of geometry.columnEdges) out.push(p);
    for (const p of geometry.marginEdges) out.push(p);
    // Column band edges — duplicates of the first/last columnEdge when columns
    // fit the band, but the only column-aware snap points when the band
    // collapses (viewport too narrow). Cheap insurance.
    if (config.columns) {
      const { margin, maxWidth } = config.columns;
      const vw = window.innerWidth;
      const marginsCfg = config.margins;
      const anchorEl = marginsCfg?.anchor
        ? document.querySelector<HTMLElement>(
            `[data-keyline="${cssEscape(marginsCfg.anchor)}"]`,
          )
        : null;
      let bandLeft: number;
      let bandWidth: number;
      if (anchorEl && marginsCfg) {
        const rect = anchorEl.getBoundingClientRect();
        const marginWidth = parseOffset(marginsCfg.width, rect.width);
        bandLeft = rect.left + marginWidth;
        bandWidth = rect.width - marginWidth * 2;
      } else {
        bandWidth = maxWidth
          ? Math.min(maxWidth, vw - margin * 2)
          : vw - margin * 2;
        bandLeft = maxWidth ? Math.max(margin, (vw - bandWidth) / 2) : margin;
      }
      out.push(bandLeft, bandLeft + bandWidth);
    }
  } else {
    if (geometry.containerRect) {
      out.push(geometry.containerRect.top, geometry.containerRect.bottom);
    }
    // Baselines snap to a viewport-aligned step grid regardless of the
    // anchor offset used by the renderer — the snap target is the regular
    // step grid the user reasons about, not the painted offset.
    if (config.baseline) {
      const step = config.baseline.step;
      for (let p = 0; p <= vh; p += step) out.push(p);
    }
    out.push(0, vh);
  }
  return out;
}
