import { resolveConfig } from "../config.js";
import type { ResolvedConfig } from "../types.js";
import { type ControlButton, mountControlButton } from "./button.js";
import { KEYLINE_CHROME_SELECTOR, round1 } from "./dom.js";
import { computeGeometry, nearestOnAxis } from "./geometry.js";
import { bindHotkeys, type HotkeyBinder } from "./hotkeys.js";
import { type KeyboardHud, mountHud } from "./hud.js";
import { type Inspector, mountInspector } from "./inspector.js";
import { LocalGuideStore } from "./local-guides.js";
import { KeylineRenderer } from "./renderer.js";
import { mountRhythmScope, type RhythmScope } from "./rhythm-scope.js";
import { mountRulers, type RulerSurface } from "./rulers.js";
import { installSnapshotGlobal } from "./snapshot.js";
import { KeylineStore } from "./store.js";
import { watchBucket } from "./viewport.js";

/**
 * The activator. One singleton per page. Owns:
 *  - the resolved project config (from <Keyline> props or activate() arg)
 *  - the store (overlay enabled + per-family visibility, persisted)
 *  - the renderer (paints the overlay)
 *  - the floating control button
 *  - hotkey bindings
 *  - element discovery (MutationObserver on data-keyline attributes)
 *  - per-element ResizeObserver to track rect changes
 *
 * Idempotent: activate() called twice returns the existing instance.
 *
 * Tear-down (instance.destroy()) removes the overlay, disconnects all
 * observers, unbinds hotkeys, and removes the floating button.
 */
export interface ActivationInstance {
  destroy: () => void;
}

let _instance: SingletonState | null = null;

interface SingletonState {
  config: ResolvedConfig;
  store: KeylineStore;
  renderer: KeylineRenderer;
  button: ControlButton | null;
  hud: KeyboardHud | null;
  rulers: RulerSurface | null;
  inspector: Inspector | null;
  hotkeys: HotkeyBinder;
  mutationObserver: MutationObserver;
  resizeObserver: ResizeObserver;
  elements: Set<HTMLElement>;
  scheduled: boolean;
  /** Current element specs — read by snapshot() for container rects + drift. */
  getSpecs: () => ElementSpec[];
  destroy: () => void;
}

/**
 * Read `data-keyline-*` attributes off an element into a per-element override.
 * Currently supported:
 *   - data-keyline="<label>"   the label (the attribute's value)
 *   - data-keyline-margin="<offset>"   per-element margin width (overrides project)
 *   - data-keyline-color="<color>"     per-element color (overrides project)
 */
export interface ElementSpec {
  el: HTMLElement;
  label: string;
  margin?: string;
  color?: string;
}

function readSpec(el: HTMLElement): ElementSpec {
  return {
    el,
    label: el.getAttribute("data-keyline") ?? "",
    margin: el.getAttribute("data-keyline-margin") ?? undefined,
    color: el.getAttribute("data-keyline-color") ?? undefined,
  };
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

/** Find all currently-mounted `[data-keyline]` elements in the document. */
function discoverAll(root: Document | HTMLElement = document): HTMLElement[] {
  const list: HTMLElement[] = [];
  for (const el of root.querySelectorAll<HTMLElement>("[data-keyline]")) {
    list.push(el);
  }
  return list;
}

export function activate(
  userConfig?: Parameters<typeof resolveConfig>[0],
): ActivationInstance {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { destroy: () => {} };
  }

  // Idempotent. StrictMode double-invocation, multiple <Keyline /> mounts at
  // different points in the tree, HMR — all converge to one instance.
  if (_instance) {
    return { destroy: () => _instance?.destroy() };
  }

  // HMR seam: a module hot-swap resets `_instance` to null while the OLD
  // overlay DOM is still in <body> — the next activation would stack a
  // second overlay on top (two baseline grids, two buttons…). The module
  // singleton can't survive a module swap, so enforce idempotency at the
  // DOM level too: sweep any stale keyline nodes before mounting.
  for (const el of document.querySelectorAll(
    `${KEYLINE_CHROME_SELECTOR},[data-keyline-offset-chip]`,
  )) {
    el.remove();
  }

  const config: ResolvedConfig = resolveConfig(userConfig);

  const store = new KeylineStore(config);
  const renderer = new KeylineRenderer(config);
  const elements = new Set<HTMLElement>();

  let rhythmScope: RhythmScope | null = null;
  let inspectorRef: Inspector | null = null;

  let scheduled = false;
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const specs: ElementSpec[] = [];
      for (const el of elements) {
        if (!el.isConnected) {
          elements.delete(el);
          continue;
        }
        specs.push(readSpec(el));
      }
      renderer.baselineScope = rhythmScope?.get() ?? null;
      renderer.baselineOffset = rhythmScope?.getOffset() ?? 0;
      renderer.paint(store.get(), specs);
      // Pins live-update on the same tick that repaints the overlay — this
      // is what makes them track HMR remounts and layout changes.
      inspectorRef?.tick();
      logDriftTransitions(specs);
    });
  };

  // Passive agent channel: log drift TRANSITIONS (aligned → off, off →
  // aligned) for named containers. Console-reading agents see alignment
  // issues with zero instrumentation; humans get a quiet audit trail.
  // Only transitions are logged — steady state stays silent.
  const driftState = new Map<string, string>();
  const logDriftTransitions = (specs: ElementSpec[]) => {
    if (!store.get().enabled) return;
    const geometry = computeGeometry(config);
    for (const spec of specs) {
      const r = spec.el.getBoundingClientRect();
      const nx = nearestOnAxis(geometry, "x", r.left);
      const parts: string[] = [];
      if (nx && Math.abs(nx.delta) >= 0.5 && Math.abs(nx.delta) <= 24) {
        parts.push(
          `x ${nx.delta > 0 ? "+" : ""}${round1(nx.delta)} off ${nx.kind}`,
        );
      }
      const next = parts.join(" · ") || "aligned";
      const prev = driftState.get(spec.label);
      if (prev !== undefined && prev !== next) {
        console.info(
          `[keyline] ${spec.label}: ${next}${next === "aligned" ? " ✓" : ` (was ${prev})`}`,
        );
      }
      driftState.set(spec.label, next);
    }
  };

  // Initial discovery + observation.
  const resizeObserver = new ResizeObserver(() => schedule());
  const observe = (el: HTMLElement) => {
    if (elements.has(el)) return;
    elements.add(el);
    resizeObserver.observe(el);
    schedule();
  };
  const unobserve = (el: HTMLElement) => {
    if (!elements.has(el)) return;
    elements.delete(el);
    resizeObserver.unobserve(el);
    schedule();
  };

  for (const el of discoverAll()) observe(el);

  // Watch for elements added later (route changes, conditional render) and
  // attribute changes (data-keyline added/removed dynamically).
  const mutationObserver = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "attributes" && r.target instanceof HTMLElement) {
        const target = r.target;
        if (target.hasAttribute("data-keyline")) observe(target);
        else unobserve(target);
      } else if (r.type === "childList") {
        for (const node of r.addedNodes) {
          if (!isElement(node)) continue;
          if (node.matches("[data-keyline]")) observe(node);
          for (const sub of node.querySelectorAll<HTMLElement>(
            "[data-keyline]",
          ))
            observe(sub);
        }
        for (const node of r.removedNodes) {
          if (!isElement(node)) continue;
          if (elements.has(node)) unobserve(node);
          for (const sub of Array.from(elements)) {
            if (node.contains(sub)) unobserve(sub);
          }
        }
      }
    }
  });
  mutationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "data-keyline",
      "data-keyline-margin",
      "data-keyline-color",
    ],
  });

  // Re-paint on viewport changes (scroll changes rect coords; resize changes
  // viewport dims used by `<Keyline lines>` percent values).
  const onScroll = () => schedule();
  const onResize = () => schedule();
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onResize);

  // Repaint when state changes (hotkey toggles).
  const unsubscribe = store.subscribe(() => schedule());

  // Keyboard HUD (auto-shows on first few activations; recall with `?`).
  const hud = mountHud({
    config,
    store,
    corner: config.button ? config.button.corner : "bottom-right",
  });

  // Floating control button.
  const button = config.button
    ? mountControlButton({
        config,
        store,
        corner: config.button.corner,
        onShowHud: () => hud.show(),
      })
    : null;

  // Local-guide store + ruler drag surface (PixelSnap-style).
  const localGuides = config.rulers ? new LocalGuideStore() : null;
  const rulers =
    config.rulers && localGuides
      ? mountRulers({ config, store, localGuides, schedule })
      : null;

  // Hold-B-and-click baseline scoping (ephemeral; the declared counterpart
  // is a committed `data-keyline-rhythm` attribute — future slice).
  rhythmScope = mountRhythmScope({ config, store, schedule });

  // Hover inspector (desktop): local-reference measurements + pins.
  const inspector = mountInspector({
    config,
    store,
    getBaselineScope: () => rhythmScope?.get() ?? null,
    getBaselineOffset: () => rhythmScope?.getOffset() ?? 0,
  });
  inspectorRef = inspector;

  // Re-resolve everything when the viewport bucket changes (responsive
  // config: columns/margins/baseline can differ per bucket). Full teardown +
  // re-activate keeps every module consistent without per-module setConfig
  // plumbing — this is a dev tool, the cost is irrelevant.
  const unwatchBucket = watchBucket(() => {
    const cfg = userConfig;
    instance.destroy();
    activate(cfg);
  });

  // Hotkeys — family / ruler / HUD keys ONLY listen when the overlay is on.
  // The baseline key is owned by rhythm-scope (hold+click semantics), so it
  // is disabled here to avoid double-toggling.
  const hotkeys = bindHotkeys(
    { ...config.hotkeys, toggleBaseline: "" },
    {
      toggleAll: () => store.toggleEnabled(),
      toggleKeylines: () => store.toggleFamily("keylines"),
      toggleColumns: () => store.toggleFamily("columns"),
      toggleBaseline: () => store.toggleFamily("baseline"),
      toggleMargins: () => store.toggleFamily("margins"),
      toggleRulers: () => store.toggleFamily("rulers"),
      showHud: () => hud?.show(),
      closeOverlay: () => store.setEnabled(false),
    },
    () => store.get().enabled,
  );

  // First paint.
  schedule();

  const instance: SingletonState = {
    config,
    store,
    renderer,
    button,
    hud,
    rulers,
    inspector,
    hotkeys,
    mutationObserver,
    resizeObserver,
    elements,
    scheduled,
    getSpecs: () => {
      const specs: ElementSpec[] = [];
      for (const el of elements) {
        if (el.isConnected) specs.push(readSpec(el));
      }
      return specs;
    },
    destroy: () => {
      unwatchBucket();
      unsubscribe();
      hotkeys.unbind();
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("scroll", onScroll, {
        capture: true,
      } as EventListenerOptions);
      window.removeEventListener("resize", onResize);
      button?.destroy();
      rulers?.destroy();
      hud?.destroy();
      inspector?.destroy();
      rhythmScope?.destroy();
      renderer.destroy();
      _instance = null;
    },
  };

  installSnapshotGlobal();

  _instance = instance;
  return { destroy: () => instance.destroy() };
}

/** Get the current activated instance (or null). Mostly for tests. */
export function getInstance(): SingletonState | null {
  return _instance;
}

/**
 * Install a one-time dev-mode check: if any `[data-keyline]` elements exist
 * 1 second after page load and no activator is mounted, log a one-time hint.
 *
 * Called automatically when the `keyline` module is imported (in dev mode).
 * Idempotent — safe to call from multiple modules.
 */
let _warningInstalled = false;
export function installMissingActivatorWarning(): void {
  if (_warningInstalled) return;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  _warningInstalled = true;

  const check = () => {
    if (_instance) return;
    const found = document.querySelector("[data-keyline]");
    if (found) {
      // eslint-disable-next-line no-console
      console.warn(
        "[keyline] Found `[data-keyline]` attributes on the page but no <Keyline /> activator mounted. " +
          "Drop <Keyline /> in your root layout, or call activate() at boot.",
      );
    }
  };

  if (document.readyState === "complete") {
    setTimeout(check, 1000);
  } else {
    window.addEventListener("load", () => setTimeout(check, 1000), {
      once: true,
    });
  }
}
