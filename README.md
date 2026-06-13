# keyline

> Figma-style alignment guides for your project — directly in the browser. Committed to the repo, so the whole team designs to the same system.

You're the obsessive designer who felt pain looking at things that didn't align. In Figma or Sketch you set up your keylines, your column grid, your baseline rhythm — and you shipped pixel-perfect.

Now everyone's coding with AI. It's easier than ever to design directly in code. But you lost the helpers your design tool gave you. There's no grid panel in the browser. No baseline rhythm. No margin guides. You eyeball it. The drift creeps in.

**keyline brings those helpers back, right over your running app.** And because the configuration lives in the repo, every teammate (and every coding agent) follows the same alignment system — automatically.

Drop one component at root, mark your content container with one attribute, press **K**.

```tsx
// app/layout.tsx
<Keyline margins={{ width: 24, anchor: "content" }} />

// Mark your content container, anywhere:
<div className="mx-auto max-w-2xl" data-keyline="content">
  <Article />
</div>
```

That's it. Press **K**.

---

## Install

```sh
bun add keyline    # or npm / pnpm / yarn
```

## What you get on the keyboard

| Key | Action |
|---|---|
| `K` | Show / hide overlay (the global key) |
| `M` | Margin strips |
| `C` | Column grid |
| `B` | Baseline rhythm |
| `L` | Positional lines (declared in config) |
| `R` | Rulers (drag from a ruler to drop a local guide) |
| `B` + click | Scope the baseline grid to one component (rest of page dims) |
| `B` + drag | Nudge the grid phase while scoped |
| `Alt` + click | Select a measurement reference (then hover to measure between) |
| `P` | Pin the current measurement |
| `?` | Show the keyboard panel |
| `Esc` | Clear selection / hide the overlay |

The family keys (M / C / B / L / R / ? / Esc) **only listen while the overlay is showing**. That keeps the host app's keyboard untouched until you press `K` — then for the duration of overlay-mode, the keyboard belongs to keyline.

You don't need to memorize the keys: the first few times you press `K`, a small HUD shows them. After that it goes quiet. Recall it any time with `?`.

Ignored while you're typing in inputs. Last state persists across reloads. The floating button in the corner is the mouse equivalent — hover for per-family toggles, click to show/hide.

---

## The mental model

Everything lives on one shared overlay above your page. Five families:

- **Margins** — tinted strips marking the "safe area" inside your content container (Apple HIG / Material style).
- **Columns** — the column grid, automatically sitting inside the margins (Figma frame model).
- **Baseline** — horizontal rhythm grid for vertical alignment.
- **Positional lines** — single guides at fixed coordinates (optional, declared in config).
- **Rulers + local guides** — drag from the rulers to drop scratch guides for pixel-perfect spot checking. Stored in your browser, scoped to the page.

**You only need to know one mechanism**: drop `<Keyline />` once with your config, mark your content container with `data-keyline="content"`. Margins anchor to that element. Columns auto-anchor to the same place, inset by the margin width. Refactor `max-w-2xl` to `max-w-3xl` and everything moves with the className. No second source of truth.

---

## A complete setup

For most apps, this is the whole config:

```tsx
// app/layout.tsx
import { Keyline } from "keyline";

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        {process.env.NODE_ENV === "development" && (
          <Keyline
            margins={{ width: 24, anchor: "content" }}
            columns={{ count: 12, gutter: 16 }}
            baseline={{ step: 4, emphasizeEvery: 4 }}
          />
        )}
      </body>
    </html>
  );
}
```

Then on any page's content container:

```tsx
<div className="max-w-2xl mx-auto px-6 py-8" data-keyline="content">
  <PageBody />
</div>
```

Press **K**. You see margins on each side, a 12-column grid centered between them, a 4px baseline rhythm with major lines every 16px, and a thin ruler along the top and left edges.

Change `max-w-2xl` to `max-w-3xl` — the margins and columns follow. The class is the layout AND the guide.

### Responsive buckets

Any family accepts per-viewport values, keyed by `phone` / `tablet` / `desktop` (mobile-first fallback, like Tailwind prefixes). Buckets are decided by the viewport's shortest side, so rotating a phone never flips the bucket:

```tsx
<Keyline
  columns={{
    phone: { count: 4, gutter: 12 },
    tablet: { count: 8, gutter: 16 },
    desktop: { count: 12, gutter: 16, maxWidth: 1280 },
  }}
/>
```

---

## Rulers & local guides

When the overlay is on, two thin rulers appear along the top and left edges. **Drag from a ruler onto the page to drop a guide.** The guide snaps to the nearest column edge, baseline line, margin edge, or declared line within 6 px. Hold `Shift` while dragging to disable snapping.

- **Drag an existing guide** to reposition it (or off the page, back into the ruler, to delete it).
- **Alt-drag a guide** to duplicate it (Figma-style — the copy stays put).
- **Double-click a guide** to delete it.
- **Click the corner square** (top-left, where the rulers meet) to clear every guide on this page.
- `R` toggles the rulers without removing existing guides.

Local guides are **scoped to the current path** (`location.pathname` — query strings and hashes are ignored) and persist in `localStorage` under `keyline:local-guides:v1:<path>`. They're per-developer — they don't follow you across machines, and they don't end up in the repo. That's intentional: declared `lines` in your `<Keyline>` config are the team contract; local guides are your scratch pad.

Visually, declared lines are solid; local guides are **dashed** so the eye separates "this is the system" from "this is mine."

To turn the whole feature off:

```tsx
<Keyline rulers={false} />
```

To loosen or tighten the snap:

```tsx
<Keyline rulers={{ snapDistance: 12 }} />
```

---

## Zero-impact promise

> Adding or removing keyline causes **zero changes** to your app's CSS or layout. Delete the package — your rendered output is pixel-identical.

How:

- **No wrappers** around your elements.
- **No marker children** that would shift `:nth-child` or `:empty`.
- **No refs** to manage.
- **No imports** in production builds.

The only DOM footprint:

1. A `data-keyline="..."` attribute on YOUR existing element (you add it; you remove it).
2. One overlay `<div>` and one floating button appended to `<body>` at dev-mode runtime. Removed when the activator unmounts.

> **Don't style on `[data-keyline]`** in your app's CSS — it's a tooling marker, not a styling hook.

---

## What you should know

- **Production safety.** Tree-shaken to zero bytes when `NODE_ENV === "production"`.
- **Responsive automatically.** Whatever your Tailwind resolves to is what gets measured — no breakpoint config in keyline.
- **Route changes.** Margins and columns re-anchor automatically when each page mounts its `data-keyline="content"` element. Add the attribute on every primary route.
- **Multiple containers.** Several elements with the same `data-keyline` value are merged at the union of their bounding rects.
- **Forgot the activator?** If keyline sees `[data-keyline]` attributes but no `<Keyline />` mounted, it logs a one-time dev hint.

---

## That's it.

Most apps don't need anything below this line.

---

## If you need more

### Don't have a `data-keyline` element on a page yet

If your activator declares an anchor (`margins={{ anchor: "content" }}`) but a page is missing the attribute, margins fall back to the viewport edges. Just add `data-keyline="content"` to that page's container.

### Hide the floating button

```tsx
<Keyline button={false} />

// or move it:
<Keyline button={{ corner: "bottom-left" }} />
```

You can also just **drag the button to any corner** — the position persists per-developer and overrides the prop.

### Margins without an anchor (viewport edges)

If you'd rather margins always sit at the viewport edges, omit `anchor`:

```tsx
<Keyline margins={{ width: 24 }} />
```

### Columns without margins (standalone)

If you don't use margins but want a centered column grid:

```tsx
<Keyline columns={{ count: 12, gutter: 16, margin: 24, maxWidth: 1280 }} />
```

The grid centers itself in the viewport with the given `margin` inset and `maxWidth` cap.

### Positional guides (single lines at fixed coordinates)

For ad-hoc rules not tied to a container:

```tsx
<Keyline
  lines={[
    { left: "50%", label: "midpoint" },
    { top: "4rem", label: "header-end" },
    { bottom: "env(safe-area-inset-bottom)" },
  ]}
/>
```

Numbers are pixels. Strings are any CSS length the browser understands — `"24px"`, `"1.5rem"`, `"50%"`, `"calc(50% - 16px)"`, `"min(100%, 1024px)"`, `"10vw"`.

Toggle with `L` or the floating panel.

### Different colors

```tsx
<Keyline color="oklch(70% 0.18 230)" />
```

Sets the keyline / margin hue. Columns keep their own blue by default — override via the `theme` prop:

```tsx
<Keyline
  color="oklch(70% 0.18 230)"
  theme={{ column: "rgba(255, 200, 0, 0.16)" }}
/>
```

Per-element color override:

```tsx
<div data-keyline="content" data-keyline-color="rgba(255,60,60,0.7)">
```

### Auto-invert against any background

```tsx
<Keyline blend />
```

Uses `mix-blend-mode: difference`. Works on most backgrounds; can fade on mid-gray gradients.

### K is taken in my app

```tsx
<Keyline hotkeys={{ toggleAll: "shift+k" }} />
```

Combos accept `shift`, `alt`, `ctrl`, `cmd`. Empty string disables. Family keys (M / C / B / L / R / ?) are likewise overridable — but remember they only fire when the overlay is on, so collisions are usually fine.

### Presets

```tsx
<Keyline preset="12-col" />
// presets: "8pt", "4pt", "12-col", "bootstrap"
```

### My design system has a `<Container>` component

The DS author adds the attribute once:

```tsx
function Container({ variant, children }) {
  const classes = cva(/* … */)({ variant });
  return (
    <div className={classes} data-keyline={variant}>
      {children}
    </div>
  );
}
```

Consumers don't import keyline. Every `<Container>` auto-contributes a guide when the app has the activator mounted. If keyline isn't installed, the attribute is inert.

### Not using React

```ts
import { mount } from "keyline/core";
mount({ margins: { width: 24, anchor: "content" } });
```

Vue / Svelte / Astro: call `mount()` in the framework's mount hook. The `data-keyline` attribute works identically.

---

## Reference

### `<Keyline />` props

| Prop | Type | Default | Description |
|---|---|---|---|
| `margins` | `{ width: Offset; anchor?: string } \| ByBucket \| false` | — | Tinted strips inside the anchored element. No anchor = viewport edges. |
| `columns` | `{ count, gutter, margin?, maxWidth?, fill? } \| ByBucket \| false` | — | Column grid. Auto-anchors to `margins.anchor` when set. |
| `baseline` | `{ step: number; emphasizeEvery?: number } \| ByBucket \| false` | — | Baseline rhythm grid. |
| `lines` | `PositionalLine[]` | `[]` | Single guides at fixed coordinates. |
| `rulers` | `boolean \| { snapDistance }` | `true` | Top + left rulers, drag to drop local guides. |
| `color` | `string` | `rgba(236,72,153,0.7)` | Project color for keylines and margins. |
| `theme` | `Partial<KeylineTheme>` | derived | Per-family color overrides. |
| `hotkeys` | `Partial<KeylineHotkeys>` | `{ toggleAll: "k", ... }` | Keyboard shortcuts. |
| `preset` | `"8pt" \| "4pt" \| "12-col" \| "bootstrap"` | — | Baseline + columns shortcut. |
| `blend` | `boolean` | `false` | `mix-blend-mode: difference` overlay. |
| `button` | `boolean \| { corner?: ... }` | `{ corner: "bottom-right" }` | Floating control button. |
| `zIndex` | `number` | `MAX_SAFE_INTEGER` | Overlay stacking. |
| `startHidden` | `boolean` | `true` | Start with overlay off. |

### `data-keyline` attributes

| Attribute | Type | Description |
|---|---|---|
| `data-keyline` | `string` | Label / anchor name. Multiple elements with the same value are merged. |
| `data-keyline-margin` | CSS length | Per-element margin width override. |
| `data-keyline-color` | CSS color | Per-element color override. |

### Offset values (used by `lines`, `margins.width`, etc.)

| Value | Meaning |
|---|---|
| `24` or `"24px"` | 24 pixels |
| `"1.5rem"` | Browser-resolved rem |
| `"50%"` | Percent of the anchor's width/height |
| `"calc(50% - 16px)"` | Full CSS math |
| `"env(safe-area-inset-bottom)"` | Environment variables |
| Any CSS length | Browser-parsed via hidden probe |

---

## Common gotchas

- **`content-visibility: auto`** on a `[data-keyline]` element collapses the rect to the size hint when offscreen. Set `contain-intrinsic-size` to a realistic value.
- **Shadow DOM**: closed shadow roots aren't discoverable via `document.querySelectorAll`. Annotate the host element instead.
- **You see nothing after pressing K**: clear `localStorage` (`keyline:state:v1`), or check that your container has non-zero measurable width.
- **Margins look huge on a narrow viewport**: margins suppress when they'd exceed ~40% of the container width. Below that threshold they hide automatically.
- **Crisp lines on retina**: rendered as 1 device pixel (0.5 CSS px on 2x), matching native iOS dividers.

---

## What it doesn't do

- Doesn't enforce — surfaces.
- Doesn't override your CSS — overlays on `<body>`.
- Doesn't add anything inside your app's DOM tree — only the attribute YOU wrote, plus one overlay node on `<body>`.
- Doesn't ship in production — tree-shaken.

---

## For coding agents

Keyline treats agents as first-class users of the same overlay:

- **`window.keyline.snapshot()`** (also exported as `snapshot()`) returns the resolved geometry — bucket, column edges, baseline lines, margin edges, containers, and per-container drift. An agent can check alignment without screenshots.
- **Drift transitions are logged**: `[keyline] content: x +3 off column (was aligned)` — console-reading agents see misalignment appear and disappear as they edit.
- The `data-keyline` attributes are the shared vocabulary: the same labels humans see in the overlay are the keys agents see in the snapshot.

## Coming later

- Touch support (long-press to measure, bottom-sheet controls).
- `keyline.audit()` returning structured violations for CI.
- Export a local guide → declared `lines` config entry (so scratch becomes spec).

---

MIT.
