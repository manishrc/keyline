"use client";

import { useEffect, useMemo } from "react";
import { activate, installMissingActivatorWarning } from "./core/registry.js";
import type { KeylineConfig } from "./types.js";

// One-time dev-mode hint when [data-keyline] elements exist but no activator.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  installMissingActivatorWarning();
}

export type KeylineProps = KeylineConfig;

/**
 * Drop once at the root of your app:
 *
 *   <Keyline />
 *
 *   <Keyline preset="12-col" margins={{ width: 24 }} />
 *
 * Then mark any element you want guided with `data-keyline="<label>"`.
 *
 * - SSR-safe: nothing touches `window` during render.
 * - Production: no-op when `NODE_ENV === "production"`. Bundlers tree-shake
 *   the core when the guard branch is dead.
 */
export function Keyline(props: KeylineProps): null {
  // Stabilize props by JSON identity. Users typically inline this once at the
  // root and never change it; structural equality is the safest semantic.
  const fingerprint = useMemo(() => safeStringify(props), [props]);

  // The fingerprint is a structural-identity key for props — re-activate only
  // when the config actually changes, not on inline-object identity churn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fingerprint stands in for props by design
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const instance = activate(props);
    return () => instance.destroy();
  }, [fingerprint]);

  return null;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return Math.random().toString(36);
  }
}

export type { DriftEntry, KeylineSnapshot } from "./core/snapshot.js";
export { snapshot } from "./core/snapshot.js";
export type {
  BaselineGrid,
  Bucket,
  ByBucket,
  ColumnGrid,
  KeylineConfig,
  KeylineHotkeys,
  KeylineTheme,
  KeylineVisibility,
  MarginGuides,
  PositionalLine,
  PresetName,
  RulerConfig,
} from "./types.js";
