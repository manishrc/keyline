import type {
  BaselineGrid,
  Bucket,
  ColumnGrid,
  MarginGuides,
  PositionalLine,
} from "../types.js";
import { round1 } from "./dom.js";
import { computeGeometry, nearestOnAxis } from "./geometry.js";
import { getInstance } from "./registry.js";
import { getBucket } from "./viewport.js";

/**
 * snapshot() — the programmatic door for agents, CI, and DevTools.
 *
 * A human reads the overlay; an agent (or a Playwright assertion) reads this.
 * Returns the fully resolved geometry at the current viewport plus a drift
 * report: which `data-keyline` containers sit off-grid and by how much.
 *
 * Also exposed as `window.keyline.snapshot()` so it's discoverable from the
 * browser console via autocomplete.
 */
export interface DriftEntry {
  container: string;
  axis: "x" | "y";
  /** Signed CSS px from the container edge to the nearest grid feature. */
  delta: number;
  nearest: "column" | "baseline" | "margin" | "line";
}

export interface KeylineSnapshot {
  bucket: Bucket;
  viewport: { w: number; h: number; dpr: number };
  config: {
    columns?: ColumnGrid;
    baseline?: BaselineGrid;
    margins?: MarginGuides;
    lines: PositionalLine[];
  };
  resolved: {
    columnEdges: number[];
    baselineLines: number[];
    marginEdges: number[];
    declaredLines: { axis: "x" | "y"; pos: number; label?: string }[];
  };
  containers: {
    label: string;
    rect: { x: number; y: number; width: number; height: number };
  }[];
  drift: DriftEntry[];
}

/** Drift window — same thresholds as the inspector readout. */
const DRIFT_MIN = 0.5;
const DRIFT_MAX = 24;

export function snapshot(): KeylineSnapshot {
  if (typeof window === "undefined") {
    throw new Error(
      "keyline.snapshot() requires window. Call it from a client component, useEffect, or the browser console.",
    );
  }
  const instance = getInstance();
  if (!instance) {
    throw new Error(
      "keyline.snapshot(): no <Keyline /> activator is mounted. Drop <Keyline /> in your root layout first.",
    );
  }

  const config = instance.config;
  const geometry = computeGeometry(config);
  const specs = instance.getSpecs();

  const containers = specs.map((s) => {
    const r = s.el.getBoundingClientRect();
    return {
      label: s.label,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    };
  });

  const drift: DriftEntry[] = [];
  for (const spec of specs) {
    const r = spec.el.getBoundingClientRect();
    const nx = nearestOnAxis(geometry, "x", r.left);
    if (
      nx &&
      Math.abs(nx.delta) >= DRIFT_MIN &&
      Math.abs(nx.delta) <= DRIFT_MAX
    ) {
      drift.push({
        container: spec.label,
        axis: "x",
        delta: round1(nx.delta),
        nearest: nx.kind,
      });
    }
    const ny = nearestOnAxis(geometry, "y", r.top);
    if (
      ny &&
      Math.abs(ny.delta) >= DRIFT_MIN &&
      Math.abs(ny.delta) <= DRIFT_MAX
    ) {
      drift.push({
        container: spec.label,
        axis: "y",
        delta: round1(ny.delta),
        nearest: ny.kind,
      });
    }
  }

  return {
    bucket: getBucket(),
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    },
    config: {
      columns: config.columns,
      baseline: config.baseline,
      margins: config.margins,
      lines: config.lines,
    },
    resolved: {
      columnEdges: geometry.columnEdges.map(round1),
      baselineLines: geometry.baselineLines,
      marginEdges: geometry.marginEdges.map(round1),
      declaredLines: geometry.declaredLines,
    },
    containers,
    drift,
  };
}

/**
 * Install `window.keyline` so the API is discoverable from the console.
 * Idempotent. The snapshot function itself works in any env; only this
 * convenience global is keyline-owned namespace on window.
 */
let _globalInstalled = false;
export function installSnapshotGlobal(): void {
  if (_globalInstalled) return;
  if (typeof window === "undefined") return;
  _globalInstalled = true;
  (window as unknown as { keyline: object }).keyline = {
    snapshot,
    getDrift: () => snapshot().drift,
  };
}
