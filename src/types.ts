/**
 * keyline — Figma-style alignment guides for the browser.
 *
 * Mental model:
 *   - One activator at root: <Keyline /> (React) or activate() (vanilla).
 *   - One overlay painted on top of the page.
 *   - Elements with `data-keyline="<label>"` contribute edge guides.
 *   - Optional positional lines, columns, baseline configured on the activator.
 */

/** A CSS length value — number → px, string → any CSS length the browser parses. */
export type Offset = number | string;

/**
 * Viewport buckets. Phone is detected by the shortest viewport side (<600px)
 * so rotating a phone never flips the bucket; tablet is anything narrower
 * than 1280px; desktop is the rest.
 */
export type Bucket = "phone" | "tablet" | "desktop";

/**
 * Responsive config: any family config can be keyed by bucket instead of
 * passed flat. Mirrors the Tailwind responsive-prefix mental model.
 *
 *   columns={{ count: 12 }}                                  // all buckets
 *   columns={{ phone: { count: 4 }, desktop: { count: 12 }}} // per bucket
 *
 * Missing buckets fall back to the nearest SMALLER bucket, then larger.
 */
export type ByBucket<T> = Partial<Record<Bucket, T>>;

/**
 * A positional line at a fixed coordinate (not anchored to a DOM element).
 * Exactly one of left/right/top/bottom encodes BOTH axis and anchor edge.
 *
 *   { left: "50%", label: "midpoint" }
 *   { top: "4rem", label: "header-end" }
 *   { bottom: "env(safe-area-inset-bottom)" }
 *   { left: 24 }                          // anonymous (no label chip)
 */
export interface PositionalLine {
  left?: Offset;
  right?: Offset;
  top?: Offset;
  bottom?: Offset;
  label?: string;
  color?: string;
}

/** A vertical column grid. */
export interface ColumnGrid {
  count: number;
  gutter: number;
  margin: number;
  maxWidth?: number;
  fill?: boolean;
}

/** Horizontal baseline rhythm grid (default 8px). */
export interface BaselineGrid {
  step: number;
  emphasizeEvery?: number;
}

/**
 * Margin strips — the Apple HIG / Material safe-area pattern.
 *
 * Two tinted vertical strips of `width`, drawn INSIDE a container as the
 * "no-content padding zone." When no `anchor` is given the strips sit at the
 * viewport edges. When `anchor` is set, they lock to the named keyline
 * element (and follow it through route changes, because the registry
 * re-discovers `data-keyline="<anchor>"` on every navigation).
 */
export interface MarginGuides {
  /** Width of each strip. CSS length: `16`, `"1rem"`, `"5%"`. */
  width: Offset;
  /**
   * Name of a `data-keyline="<value>"` element to anchor the margins to.
   * If no element matches, strips fall back to the viewport edges. This is
   * the "global" margins pattern: set once on `<Keyline>` at root; every
   * page contributes its own anchor element, margins stay positioned.
   */
  anchor?: string;
}

/** Per-family colors. */
export interface KeylineTheme {
  keyline: string;
  column: string;
  baseline: string;
  baselineEmphasis: string;
  margin: string;
  label: string;
  labelBackground: string;
}

/** Visibility of each family. Persisted to localStorage. */
export interface KeylineVisibility {
  keylines: boolean;
  columns: boolean;
  baseline: boolean;
  margins: boolean;
  rulers: boolean;
}

/**
 * Rulers + local guides — the PixelSnap-style measurement surface.
 *
 * When `rulers: true` (the default), two thin rulers appear along the top and
 * left edges of the viewport when the overlay is on. Drag from a ruler into
 * the page to drop a local guide. Local guides are stored per-developer in
 * localStorage, keyed by `location.pathname` so guides stay scoped to the
 * page you placed them on.
 *
 * Local guides are distinct from declared `lines` from config:
 *  - Declared lines live in the repo; they're the design-system contract.
 *  - Local guides live in your browser; they're the scratch surface for
 *    pixel-perfect spot-checking. Rendered with a dashed style to keep the
 *    two visually separate.
 */
export interface RulerConfig {
  /** Snap distance in CSS px. Guides snap to nearby columns, baseline, content edges, declared lines. */
  snapDistance: number;
}

/**
 * Keyboard shortcuts. Accepts "k", "shift+k", "cmd+k", etc. Empty disables.
 *
 * Two-mode listener:
 *  - When overlay is OFF, only `toggleAll` is active. One predictable global key.
 *  - When overlay is ON, the keyboard belongs to keyline: family keys, ruler
 *    toggle, and HUD recall (`?`) all fire from bare letters. Esc toggles off.
 *  - Modeled on Photoshop's tool palette: when the tool is active, single keys
 *    pick tools. When not, they don't.
 *  - Always ignored inside inputs / contenteditable / textareas.
 */
export interface KeylineHotkeys {
  /** Global: toggle the whole overlay. Default "k". */
  toggleAll: string;
  /** When overlay is on: toggle positional lines. Default "l". */
  toggleKeylines: string;
  /** When overlay is on: toggle columns. Default "c". */
  toggleColumns: string;
  /** When overlay is on: toggle baseline. Default "b". */
  toggleBaseline: string;
  /** When overlay is on: toggle margins. Default "m". */
  toggleMargins: string;
  /** When overlay is on: toggle rulers (the local-guide creation surface). Default "r". */
  toggleRulers: string;
  /** When overlay is on: show / recall the family HUD. Default "?". */
  showHud: string;
}

export type PresetName = "8pt" | "4pt" | "12-col" | "bootstrap";

/**
 * What the user passes to <Keyline> as props (or to activate() as the arg).
 * Everything optional; missing fields fall back to sensible defaults.
 */
export interface KeylineConfig {
  /** Project-wide color. Single CSS color string. Per-line override via `lines[].color`. */
  color?: string;
  /** When true, overlay uses `mix-blend-mode: difference` to auto-invert against bg. */
  blend?: boolean;
  /** Theme palette override. Replaces the resolved theme; partial-merge. */
  theme?: Partial<KeylineTheme>;
  /** Keyboard shortcuts. Partial-merge over defaults. */
  hotkeys?: Partial<KeylineHotkeys>;
  /** Optional preset for baseline + columns. Honest names — no vendor implications. */
  preset?: PresetName;
  /** Baseline rhythm grid. Flat, per-bucket, or `false` to disable. */
  baseline?:
    | Partial<BaselineGrid>
    | ByBucket<Partial<BaselineGrid> | false>
    | false;
  /** Column grid. Flat, per-bucket, or `false` to disable. */
  columns?: Partial<ColumnGrid> | ByBucket<Partial<ColumnGrid> | false> | false;
  /** Margin strips (Apple HIG / Material safe-area pattern). Flat, per-bucket, or `false`. */
  margins?:
    | Partial<MarginGuides>
    | ByBucket<Partial<MarginGuides> | false>
    | false;
  /** Positional lines (not anchored to elements). */
  lines?: PositionalLine[];
  /** Rulers + drag-to-create local guides. `true` enables with defaults, `false` disables, object to tune. */
  rulers?: boolean | Partial<RulerConfig>;
  /** Show the floating control button in the corner. Default true. */
  button?: boolean | { corner?: Corner };
  /** Z-index for the overlay layer. Default Number.MAX_SAFE_INTEGER. */
  zIndex?: number;
  /** Start with the overlay hidden ("invisible until summoned"). Default true. */
  startHidden?: boolean;
}

/** Viewport corner for the floating button (and the HUD that follows it). */
export type Corner = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** The fully resolved config consumed internally. All fields filled. */
export interface ResolvedConfig {
  /** The viewport bucket this config was resolved for. */
  bucket: Bucket;
  color: string;
  blend: boolean;
  theme: KeylineTheme;
  hotkeys: KeylineHotkeys;
  baseline?: BaselineGrid;
  columns?: ColumnGrid;
  margins?: MarginGuides;
  lines: PositionalLine[];
  rulers?: RulerConfig;
  button: false | { corner: Corner };
  zIndex: number;
  startHidden: boolean;
}
