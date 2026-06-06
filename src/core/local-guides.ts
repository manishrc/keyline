/**
 * Local-guide store.
 *
 * Each guide is a single horizontal or vertical line at a fixed CSS px
 * coordinate inside the viewport. Guides are user-created (drag from ruler)
 * and persist per-developer in localStorage. They are scoped to
 * `location.pathname` so the guide you dropped on the article page doesn't
 * appear on the dashboard.
 *
 * Why per-path:
 *  - PixelSnap is a desktop app — guides are session-wide. We're a web
 *    overlay; per-route is what people expect ("the article's keyline
 *    shouldn't follow me to settings").
 *  - Query strings and hashes are stripped so guides survive search params,
 *    nuqs state, anchor jumps.
 *
 * Schema is intentionally tiny — just axis + position + id.
 */

import { safeStorage } from "./dom.js";

export type GuideAxis = "x" | "y";

export interface LocalGuide {
  id: string;
  /** "x" = vertical line at `pos` px from left. "y" = horizontal line at `pos` px from top. */
  axis: GuideAxis;
  pos: number;
}

type Listener = (guides: LocalGuide[]) => void;

const STORAGE_PREFIX = "keyline:local-guides:v1:";

function storageKey(): string {
  if (typeof location === "undefined") return `${STORAGE_PREFIX}/`;
  return STORAGE_PREFIX + (location.pathname || "/");
}

function readAll(): LocalGuide[] {
  const raw = safeStorage.get(storageKey());
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isGuide);
  } catch {
    return [];
  }
}

function writeAll(guides: LocalGuide[]): void {
  safeStorage.set(storageKey(), JSON.stringify(guides));
}

function isGuide(value: unknown): value is LocalGuide {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<LocalGuide>;
  return (
    typeof v.id === "string" &&
    (v.axis === "x" || v.axis === "y") &&
    typeof v.pos === "number" &&
    Number.isFinite(v.pos)
  );
}

function newId(): string {
  return `g_${Math.random().toString(36).slice(2, 9)}`;
}

export class LocalGuideStore {
  private guides: LocalGuide[];
  private listeners = new Set<Listener>();
  private currentPath: string;
  /** Listen for popstate / pushstate-like changes so we reload per-path guides. */
  private onPopState: () => void;

  constructor() {
    this.guides = readAll();
    this.currentPath =
      typeof location !== "undefined" ? location.pathname : "/";
    this.onPopState = () => {
      const path = typeof location !== "undefined" ? location.pathname : "/";
      if (path === this.currentPath) return;
      this.currentPath = path;
      this.guides = readAll();
      this.emit();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("popstate", this.onPopState);
      // SPA route changes from next/link, react-router, etc. typically don't
      // fire popstate. Patch history.pushState/replaceState to emit a custom
      // event we can listen for. We only attach once per page.
      patchHistoryOnce();
      window.addEventListener("keyline:locationchange", this.onPopState);
    }
  }

  list(): LocalGuide[] {
    return this.guides;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  add(axis: GuideAxis, pos: number): LocalGuide {
    const guide: LocalGuide = { id: newId(), axis, pos };
    this.guides = [...this.guides, guide];
    writeAll(this.guides);
    this.emit();
    return guide;
  }

  move(id: string, pos: number): void {
    const next = this.guides.map((g) => (g.id === id ? { ...g, pos } : g));
    this.guides = next;
    writeAll(this.guides);
    this.emit();
  }

  remove(id: string): void {
    this.guides = this.guides.filter((g) => g.id !== id);
    writeAll(this.guides);
    this.emit();
  }

  clear(): void {
    this.guides = [];
    writeAll(this.guides);
    this.emit();
  }

  destroy(): void {
    if (typeof window === "undefined") return;
    window.removeEventListener("popstate", this.onPopState);
    window.removeEventListener("keyline:locationchange", this.onPopState);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.guides);
  }
}

let _historyPatched = false;
function patchHistoryOnce(): void {
  if (_historyPatched) return;
  if (typeof window === "undefined" || typeof history === "undefined") return;
  _historyPatched = true;
  const fire = () => window.dispatchEvent(new Event("keyline:locationchange"));
  const origPush = history.pushState;
  const origReplace = history.replaceState;
  history.pushState = function (
    this: History,
    ...args: Parameters<typeof origPush>
  ) {
    const ret = origPush.apply(this, args);
    fire();
    return ret;
  } as typeof origPush;
  history.replaceState = function (
    this: History,
    ...args: Parameters<typeof origReplace>
  ) {
    const ret = origReplace.apply(this, args);
    fire();
    return ret;
  } as typeof origReplace;
}
