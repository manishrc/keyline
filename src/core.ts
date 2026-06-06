/**
 * Headless, framework-agnostic entry point.
 *
 *   import { mount } from "keyline/core";
 *   mount({ preset: "12-col" });
 *
 * Then drop `data-keyline="<label>"` on any element you want guided.
 * React users want the top-level `keyline` import (<Keyline />) instead.
 */

export { resolveConfig } from "./config.js";
export { mount } from "./core/mount.js";
export type { ActivationInstance } from "./core/registry.js";
export { activate } from "./core/registry.js";
export type { DriftEntry, KeylineSnapshot } from "./core/snapshot.js";
export { snapshot } from "./core/snapshot.js";
export type { KeylineState } from "./core/store.js";
export { KeylineStore } from "./core/store.js";
export type * from "./types.js";
