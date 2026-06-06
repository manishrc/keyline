import { getBucket } from "./core/viewport.js";
import type {
  BaselineGrid,
  Bucket,
  ByBucket,
  ColumnGrid,
  KeylineConfig,
  KeylineHotkeys,
  KeylineTheme,
  KeylineVisibility,
  MarginGuides,
  Offset,
  PositionalLine,
  PresetName,
  ResolvedConfig,
  RulerConfig,
} from "./types.js";

/**
 * Default color — flat saturated magenta. What Figma's guides and Chrome's
 * grid overlay both use. Saturated enough to never read as content, calm
 * enough to live on the page while you design. User can override with `color`
 * or `blend: true` (mix-blend-mode: difference, auto-inverts against bg).
 */
const DEFAULT_COLOR = "rgba(236, 72, 153, 0.7)";
const DEFAULT_LABEL_BG = "rgba(0, 0, 0, 0.55)";

/**
 * Default column color is a flat saturated blue/cyan — distinct from the
 * pink keyline/margin family so the eye can separate "where things sit"
 * from "how things divide." Matches Figma's column-grid convention and
 * Material's column overlay.
 */
const DEFAULT_COLUMN_COLOR = "rgba(56, 189, 248, 0.5)";

function themeFromColor(
  color: string,
  labelBg = DEFAULT_LABEL_BG,
): KeylineTheme {
  return {
    keyline: color,
    // Columns get their own hue family by default. Override via theme.column.
    column: withAlpha(DEFAULT_COLUMN_COLOR, 0.16),
    // Baseline: subtle by design. The grid is rhythm reference, not visual
    // content. Hairlines + low alpha = barely-there, doesn't overpower text.
    baseline: withAlpha(color, 0.09),
    baselineEmphasis: withAlpha(color, 0.22),
    margin: withAlpha(color, 0.16), // Material/Apple "safe area" tint — saturated enough to read at a glance
    label: withAlpha(color, 0.95),
    labelBackground: labelBg,
  };
}

/**
 * Reduce an rgba() or oklch() color's effective alpha to `target`. We compose
 * by overlaying with white so the result matches when the original color is
 * already alpha. Simpler approach: parse the input, rewrite alpha. We only
 * support common rgba/oklch shapes — anything else passes through unchanged.
 */
function withAlpha(color: string, alpha: number): string {
  const rgba = /rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)/i.exec(
    color,
  );
  if (rgba) return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha})`;
  const oklch = /oklch\(\s*([\d.%]+)\s+([\d.]+)\s+([\d.]+)/i.exec(color);
  if (oklch) return `oklch(${oklch[1]} ${oklch[2]} ${oklch[3]} / ${alpha})`;
  return color;
}

const DEFAULT_THEME: KeylineTheme = themeFromColor(DEFAULT_COLOR);

/**
 * Default keys, K-centric.
 *
 *  - `k`: global toggle. Mnemonic match; home row; less collision than `g`.
 *  - Family letters (`c`, `b`, `m`, `l`, `r`) only listen when overlay is ON,
 *    so they don't ambient-collide with the host app.
 *  - `?` recalls the HUD; users see it automatically on the first few
 *    activations and can call it back any time.
 */
const DEFAULT_HOTKEYS: KeylineHotkeys = {
  toggleAll: "k",
  toggleKeylines: "l",
  toggleColumns: "c",
  toggleBaseline: "b",
  toggleMargins: "m",
  toggleRulers: "r",
  showHud: "?",
};

/** Rulers default to ON when keyline is enabled. Drag-to-create local guides. */
const DEFAULT_RULERS: RulerConfig = { snapDistance: 6 };

const DEFAULT_BASELINE: BaselineGrid = { step: 8, emphasizeEvery: 8 };
const DEFAULT_COLUMNS: ColumnGrid = {
  count: 12,
  gutter: 16,
  margin: 24,
  maxWidth: 1280,
  fill: true,
};

/** Honest preset names — no vendor implications. */
const PRESETS: Record<
  PresetName,
  Pick<KeylineConfig, "baseline" | "columns">
> = {
  "8pt": { baseline: { step: 8, emphasizeEvery: 8 } },
  "4pt": { baseline: { step: 4, emphasizeEvery: 8 } },
  "12-col": {
    columns: { count: 12, gutter: 16, margin: 24, maxWidth: 1280, fill: true },
    baseline: { step: 8, emphasizeEvery: 8 },
  },
  bootstrap: {
    columns: { count: 12, gutter: 24, margin: 12, maxWidth: 1140, fill: true },
    baseline: { step: 8, emphasizeEvery: 8 },
  },
};

const BUCKET_KEYS: Bucket[] = ["phone", "tablet", "desktop"];

/**
 * Is this family config a per-bucket record ({ phone, tablet, desktop })
 * rather than a flat config object? Detected by keys: bucket names never
 * collide with family config fields (count, gutter, step, width, ...).
 */
function isByBucket<T>(value: unknown): value is ByBucket<T> {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return (
    keys.length > 0 && keys.every((k) => (BUCKET_KEYS as string[]).includes(k))
  );
}

/**
 * Pick the config for the current bucket. Missing buckets fall back to the
 * nearest SMALLER bucket, then the nearest larger one — mobile-first, like
 * Tailwind prefixes.
 */
export function pickBucket<T>(
  value: T | ByBucket<T> | undefined,
  bucket: Bucket,
): T | undefined {
  if (value === undefined) return undefined;
  if (!isByBucket<T>(value)) return value as T;
  const order = BUCKET_KEYS.indexOf(bucket);
  for (let i = order; i >= 0; i--) {
    const key = BUCKET_KEYS[i];
    if (key === undefined) continue;
    const v = value[key];
    if (v !== undefined) return v;
  }
  for (let i = order + 1; i < BUCKET_KEYS.length; i++) {
    const key = BUCKET_KEYS[i];
    if (key === undefined) continue;
    const v = value[key];
    if (v !== undefined) return v;
  }
  return undefined;
}

function mergeBaseline(
  value: Partial<BaselineGrid> | false | undefined,
  fallback: BaselineGrid,
): BaselineGrid | undefined {
  if (value === false) return undefined;
  if (!value) return fallback;
  return { ...fallback, ...value };
}

function mergeColumns(
  value: Partial<ColumnGrid> | false | undefined,
  fallback: ColumnGrid | undefined,
): ColumnGrid | undefined {
  if (value === false) return undefined;
  if (!value) return fallback;
  return { ...(fallback ?? DEFAULT_COLUMNS), ...value };
}

function mergeMargins(
  value: Partial<MarginGuides> | false | undefined,
): MarginGuides | undefined {
  if (value === false) return undefined;
  if (!value) return undefined;
  return { width: value.width ?? 16, anchor: value.anchor };
}

/**
 * Rulers default to ON. Pass `false` to disable, `true` for defaults, an
 * object to tune. Like baseline/columns, a bare `false` removes the feature
 * entirely; absence is the same as `true`.
 */
function mergeRulers(
  value: boolean | Partial<RulerConfig> | undefined,
): RulerConfig | undefined {
  if (value === false) return undefined;
  if (value === undefined || value === true) return DEFAULT_RULERS;
  return { ...DEFAULT_RULERS, ...value };
}

/**
 * Resolve user-passed config into the fully-specified internal shape.
 *
 * Merge order: defaults → preset → user.
 * For families (baseline/columns), `false` disables; a partial object merges
 * field-by-field over the resolved preset value (which is complete).
 */
export function resolveConfig(
  user: KeylineConfig = {},
  bucket: Bucket = getBucket(),
): ResolvedConfig {
  const preset = user.preset ? PRESETS[user.preset] : {};

  const color = user.color ?? DEFAULT_COLOR;
  const theme = user.theme
    ? { ...themeFromColor(color), ...user.theme }
    : themeFromColor(color);

  const baseline = mergeBaseline(
    pickBucket(user.baseline, bucket),
    (preset.baseline as BaselineGrid | undefined) ?? DEFAULT_BASELINE,
  );

  const columns = mergeColumns(
    pickBucket(user.columns, bucket),
    preset.columns as ColumnGrid | undefined,
  );

  const margins = mergeMargins(pickBucket(user.margins, bucket));
  const rulers = mergeRulers(user.rulers);

  const button =
    user.button === false
      ? false
      : {
          corner:
            (typeof user.button === "object" && user.button.corner) ||
            ("bottom-right" as const),
        };

  return {
    bucket,
    color,
    blend: user.blend ?? false,
    theme,
    hotkeys: { ...DEFAULT_HOTKEYS, ...user.hotkeys },
    baseline,
    columns,
    margins,
    lines: user.lines ?? [],
    rulers,
    button,
    zIndex: user.zIndex ?? Number.MAX_SAFE_INTEGER,
    startHidden: user.startHidden ?? true,
  };
}

/** Default visibility for a fresh activation — families are on iff configured. */
export function defaultVisibility(config: ResolvedConfig): KeylineVisibility {
  return {
    keylines: true, // attribute-driven guides default on
    columns: !!config.columns,
    baseline: !!config.baseline,
    margins: !!config.margins,
    rulers: !!config.rulers,
  };
}

/**
 * Parse any CSS length into a pixel value relative to `frameSize`.
 *
 * Plain numbers → px. Percent values resolved against `frameSize`. Anything
 * else (rem, em, vw, calc, min/max/clamp) handed to a hidden browser probe
 * so we get full CSS support without writing a parser.
 */
let _probe: HTMLDivElement | null = null;
function getProbe(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (_probe?.isConnected) return _probe;
  _probe = document.createElement("div");
  _probe.setAttribute("data-keyline-probe", "");
  Object.assign(_probe.style, {
    position: "absolute",
    visibility: "hidden",
    pointerEvents: "none",
    width: "0",
    height: "0",
    left: "0",
    top: "0",
  } satisfies Partial<CSSStyleDeclaration>);
  document.body.appendChild(_probe);
  return _probe;
}

export function parseOffset(value: Offset, frameSize: number): number {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) return asNumber;
  if (/^[+-]?\d*\.?\d+%$/.test(trimmed)) {
    return (frameSize * Number.parseFloat(trimmed)) / 100;
  }
  const probe = getProbe();
  if (!probe) return 0;
  const sized = trimmed.replace(
    /(\d*\.?\d+)%/g,
    (_m, n) => `${(frameSize * Number(n)) / 100}px`,
  );
  probe.style.width = "0px";
  probe.style.width = sized;
  const computed = Number.parseFloat(getComputedStyle(probe).width);
  return Number.isFinite(computed) ? computed : 0;
}

/**
 * Resolve a positional line to {axis, anchor, px}. Returns null for malformed
 * input rather than throwing — this is a dev-only tool; a bad config shouldn't
 * break the host app.
 */
export interface ResolvedLine {
  label?: string;
  axis: "x" | "y";
  anchor: "left" | "right" | "top" | "bottom";
  px: number;
  color?: string;
}

export function resolveLine(
  line: PositionalLine,
  viewportWidth: number,
  viewportHeight: number,
): ResolvedLine | null {
  if (line.left !== undefined) {
    return {
      label: line.label,
      axis: "x",
      anchor: "left",
      px: parseOffset(line.left, viewportWidth),
      color: line.color,
    };
  }
  if (line.right !== undefined) {
    return {
      label: line.label,
      axis: "x",
      anchor: "right",
      px: parseOffset(line.right, viewportWidth),
      color: line.color,
    };
  }
  if (line.top !== undefined) {
    return {
      label: line.label,
      axis: "y",
      anchor: "top",
      px: parseOffset(line.top, viewportHeight),
      color: line.color,
    };
  }
  if (line.bottom !== undefined) {
    return {
      label: line.label,
      axis: "y",
      anchor: "bottom",
      px: parseOffset(line.bottom, viewportHeight),
      color: line.color,
    };
  }
  return null;
}

export {
  DEFAULT_BASELINE,
  DEFAULT_COLUMNS,
  DEFAULT_HOTKEYS,
  DEFAULT_THEME,
  PRESETS,
};
