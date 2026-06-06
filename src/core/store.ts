import { defaultVisibility } from "../config.js";
import type { KeylineVisibility, ResolvedConfig } from "../types.js";
import { safeStorage } from "./dom.js";

/**
 * Runtime state for the overlay. Two things are persisted per-developer to
 * localStorage so the tool remembers how you left it:
 *  - `enabled`:    is the whole overlay showing?
 *  - `visibility`: which families are on?
 *
 * Persistence merges into the CURRENT defaults so newly-added families default
 * to on. Older saved state (which doesn't know about a new family) inherits
 * the default for that family instead of staying "off forever."
 */

const STORAGE_KEY = "keyline:state:v1";

export interface KeylineState {
  enabled: boolean;
  visibility: KeylineVisibility;
}

type Listener = (state: KeylineState) => void;

interface PersistedState {
  enabled: boolean;
  visibility: Partial<KeylineVisibility>;
}

function readPersisted(): PersistedState | null {
  const raw = safeStorage.get(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedState;
    if (
      typeof parsed?.enabled !== "boolean" ||
      typeof parsed.visibility !== "object"
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePersisted(state: PersistedState): void {
  safeStorage.set(STORAGE_KEY, JSON.stringify(state));
}

export class KeylineStore {
  private state: KeylineState;
  private listeners = new Set<Listener>();

  constructor(config: ResolvedConfig) {
    const persisted = readPersisted();
    const baseVisibility = defaultVisibility(config);
    this.state = {
      enabled: persisted ? persisted.enabled : !config.startHidden,
      // Merge persisted choices OVER current defaults so newly-added families
      // (e.g. `margins`) default to on for users with older saved state.
      visibility: { ...baseVisibility, ...persisted?.visibility },
    };
  }

  get(): KeylineState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private commit(next: KeylineState): void {
    this.state = next;
    writePersisted({ enabled: next.enabled, visibility: next.visibility });
    for (const fn of this.listeners) fn(next);
  }

  setEnabled(enabled: boolean): void {
    this.commit({ ...this.state, enabled });
  }

  toggleEnabled(): void {
    this.setEnabled(!this.state.enabled);
  }

  toggleFamily(family: keyof KeylineVisibility): void {
    const visibility = {
      ...this.state.visibility,
      [family]: !this.state.visibility[family],
    };
    // Toggling a family on while overlay is hidden implies "show it now."
    const enabled = this.state.enabled || visibility[family];
    this.commit({ ...this.state, enabled, visibility });
  }
}
