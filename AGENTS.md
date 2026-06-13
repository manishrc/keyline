# AGENTS.md

This file is the primary context for AI agents (Claude Code and others) working in this repository. CLAUDE.md links here.

## What keyline is

A **spec-conformance overlay for development**. It paints your alignment *contract* — keylines (named reference lines), a column grid, and an 8px baseline rhythm — directly over the page, so humans **and coding agents** can see where layout violates the spec.

The committed `keyline.config.ts` **is** the contract. It's not a settings toy that lives in localStorage; it's a checked-in declaration of what "aligned" means for this project, written so an agent can read it.

Mental model: ReactScan surfaces wasted renders; keyline surfaces alignment violations.

This reframe (config-as-spec-for-agents) is load-bearing — it defines the data model. Every keyline has a `name` precisely so a violation is *nameable* ("this border misses `content-left`"), not just a stray pixel. Keep that framing when extending the project.

## Status

It's a **spike**. The shape is proven; the differentiator isn't built yet.

**Built & verified:**
- Overlay renders — keylines + column grid + 8px baseline.
- Hotkeys toggle it: `G` (whole overlay), `1` (keylines), `2` (columns), `3` (baseline).
- State persists to localStorage (`keyline:state:v1`) — remembers how you left it.
- Package builds clean for Next.js (ESM + `.d.ts`, `"use client"`, React external).
- Demo proves the thesis: on-grid text locks to the 8px baseline while deliberately off-grid text visibly drifts.

**Not built yet:** misalignment *detection*, a control panel, npm publish.

The real differentiator — **detection / audit API** (`keyline.audit()` returning programmatic violations an agent or CI can read) — is phase 2+. See **[docs/ROADMAP.md](./docs/ROADMAP.md)** rather than treating those features as present.

## Commands

bun-based. Never npm / npx / node.

| Command | Does |
| --- | --- |
| `bun install` | Install deps |
| `bun run dev` | Vite playground at **:5733** serving `/demo` — the visual verification surface |
| `bun run build` | Build the package to `dist/` (`bun build` → ESM, then `tsc` → `.d.ts` types) |
| `bun run build:types` | Types only (`tsc -p tsconfig.build.json`) |

**There is no test runner yet.** Don't invent `bun test` / `vitest` commands. Verification today is visual: `bun run dev`, load `:5733`, toggle the overlay, confirm on-grid text sits on the baseline and off-grid drifts.

## Architecture

A framework-agnostic **core** plus a thin **React adapter**.

- **Core** — `src/core/`, vanilla TS, headless, no React. Does all the work.
- **React adapter** — `src/react.tsx`, a tiny `<Keyline/>` wrapper around the core.

Three entry points, via package.json `exports`:

| Import | Surface |
| --- | --- |
| `keyline` | React `<Keyline/>` (`src/react.tsx`) — default |
| `keyline/core` | Headless `mount()` (`src/core.ts`) — Vue, Svelte, vanilla, HTML |
| `keyline/config` | `defineKeyline()` + presets + types (`src/config.ts`, `src/types.ts`) |

### Data flow

1. `defineKeyline(userConfig)` (`src/config.ts`) merges **preset → committed config** into a resolved `KeylineConfig` (shape defined in `src/types.ts`). Merge order: `BASE → preset → user`. Presets: `8pt`, `4pt`, `tailwind`, `bootstrap`.
2. `mount(config)` (`src/core/mount.ts`) wires three things together:
   - **`KeylineStore`** (`src/core/store.ts`) — observable state. Persists `enabled` + family `visibility` to localStorage `keyline:state:v1`. The committed config owns *shape*; the store owns *what's currently shown* (developer's last toggle wins after first run).
   - **`KeylineRenderer`** (`src/core/renderer.ts`) — paints a single fixed, full-viewport DOM layer (`pointer-events: none`, `aria-hidden`).
   - **hotkeys** (`src/core/hotkeys.ts`) — `G`/`1`/`2`/`3`, bare keys only.
3. Re-renders on store change and on window resize (resize is **rAF-coalesced** so drag-resize doesn't thrash).

### Rendering technique (worth knowing before you touch the renderer)

- **Columns and baseline** are painted with `repeating-linear-gradient` on **one element each** — GPU-composited, crisp at any zoom. There are **no per-line DOM nodes**. A naive loop would rebuild ~150 nodes on resize; the gradient draws all rules at once.
- **Named keylines** are individual absolutely-positioned 1px divs — one each — so every line can carry its label chip. Few by design.

When something repeats, reach for the platform's native repeat (CSS gradients, SVG patterns) before a JS loop.

### Idempotent singleton

`mount()` (`src/core/mount.ts`) is a **module-level singleton**. Calling it again returns the existing instance instead of stacking a second overlay. This is what makes it safe under React **StrictMode** (effects double-fire in dev) and **HMR**. Any "set up a global thing" added later should follow the same pattern.

## Critical build / link gotchas

These break **silently** — output looks fine, the consumer crashes. From `docs/learnings.md`.

- **React is `peerDependency` AND `external`.** Declared as a peer in package.json *and* listed in `external` in `scripts/build.ts`. **Both are required.** One without the other is a silent half-fix → consumer bundles two Reacts → "Invalid hook call".
- **`"use client"` is post-processed.** `bun build` does **not** hoist `"use client"` to line 1 — it buries it mid-file where Next.js ignores it. `scripts/build.ts` (`fixUseClient`) strips inlined copies and prepends exactly one at the top of `dist/react.js`. **Keep that step.**
- **`dist/` must exist on disk** for `bun link` to resolve it (`dist/` is gitignored; there's no CI or publish yet). **Re-run `bun run build` after editing `src/`** or the linked app sees stale output.
- **Production guard is inside the effect.** `<Keyline/>`'s `process.env.NODE_ENV === "production"` check lives *inside* the `useEffect` body (rules of hooks: the hook still runs unconditionally), so a production build folds it to an early return and dead-code-eliminates the whole component + its core imports. Safe-by-construction, not safe-by-discipline.
- **No `@types/node`.** A 5-line ambient `declare const process` lives in `src/env.d.ts` for the single `NODE_ENV` member. Don't pull `@types/node` into this browser library just for `process`.

## Consuming it elsewhere

See **[LINK.md](./LINK.md)** — the `bun link` → Next.js App Router guide: drop `<Keyline config={...} />` in the root layout, add `transpilePackages: ["keyline"]` to `next.config.ts` (the second defense against "two Reacts"), and a file-path fallback if linking fights you.

## Conventions

- **bun only.** Never npm / npx / node — for installs, scripts, and builds.
- The user's **global `~/.claude/CLAUDE.md` governs** (short replies, spike-vs-production discipline, verify-by-running, isolate→confirm→test→fix for bugs, bun over npm). It applies here; this file doesn't restate it.
