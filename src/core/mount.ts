import type { KeylineConfig } from "../types.js";
import {
  type ActivationInstance,
  activate,
  installMissingActivatorWarning,
} from "./registry.js";

if (typeof window !== "undefined") installMissingActivatorWarning();

/**
 * Vanilla-JS entry. Drop into Vue / Svelte / Astro / plain HTML at boot.
 *
 *   import { mount } from "keyline/core";
 *   mount({ preset: "12-col" });
 */
export function mount(config?: KeylineConfig): ActivationInstance {
  return activate(config);
}

export type { ActivationInstance };
