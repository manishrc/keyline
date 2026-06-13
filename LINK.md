# Using `keyline` in your Next.js apps (via `bun link`)

This gets the overlay running in another local project in ~2 minutes, with live
updates: edit keyline here → see changes in your app on refresh.

> **What you get:** press **`G`** to toggle the alignment overlay,
> **`1`/`2`/`3`** to toggle keylines / columns / baseline. Dev-only — it compiles
> out of production builds.

---

## 1. Register the link (once, in this repo)

From `keyline/`:

```sh
bun run build      # produce dist/
bun link           # registers the package name "keyline" globally
```

> Re-run `bun run build` after changing keyline's source. For continuous rebuilds
> while you iterate, run `bun run build` on save (or just re-run it when you change
> something — the spike doesn't watch yet).

## 2. Link it into each app (once per app)

From each Next.js project root (e.g. your `audiclip` and `der-die-das` apps):

```sh
bun link keyline
```

This symlinks `keyline` into that app's `node_modules`.

## 3. Add the spec file

Create `keyline.config.ts` at the app root (or `src/`). This is the **committed
contract** — the alignment rules for that project. An agent can read this file to
know what "aligned" means here.

```ts
// keyline.config.ts
import { defineKeyline } from "keyline/config";

export default defineKeyline({
  preset: "tailwind", // 12-col, 1280px container, 8px baseline
  keylines: [
    { name: "content-left", axis: "x", at: 24, unit: "px" },
    { name: "optical-center", axis: "x", at: 0, unit: "center" },
  ],
  // Optional: startHidden defaults to true ("invisible until summoned").
});
```

Pick the preset that matches the project: `"tailwind"`, `"bootstrap"`, `"8pt"`,
or `"4pt"`. Override any field afterward.

## 4. Drop `<Keyline />` into the root layout

App Router — `app/layout.tsx`:

```tsx
import { Keyline } from "keyline";
import keylineConfig from "@/keyline.config"; // adjust path/alias

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Keyline config={keylineConfig} />
      </body>
    </html>
  );
}
```

`<Keyline />` is a client component (it ships `"use client"`), renders `null`, and
mounts a fixed overlay layer it manages itself. It does **not** disturb your
layout or your React tree. In a production build it compiles away to nothing
(unless you pass `enableInProduction`).

That's it. Run `bun dev`, load any page, press **`G`**.

---

## Required: avoid the "two Reacts" error

`bun link` symlinks keyline's folder, which can contain its own React copy. Next
may then bundle **two Reacts** → `Invalid hook call` / cryptic crashes. Two
defenses, do both:

**a) Transpile the linked package** — `next.config.ts`:

```ts
const nextConfig = {
  transpilePackages: ["keyline"],
};
export default nextConfig;
```

**b) Force a single React** (only if you still see the error) — `next.config.ts`:

```ts
import path from "node:path";

const nextConfig = {
  transpilePackages: ["keyline"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      react: path.resolve("./node_modules/react"),
      "react-dom": path.resolve("./node_modules/react-dom"),
    };
    return config;
  },
};
export default nextConfig;
```

> Turbopack (`next dev --turbo`): `transpilePackages` is respected. If you hit a
> resolution issue under Turbopack specifically, fall back to `next dev` (webpack)
> while iterating, or use the file-path dependency method below.

## Alternative: skip linking, use a file path

If `bun link` fights you, add to the app's `package.json` instead:

```json
{ "dependencies": { "keyline": "file:../keyline" } }
```

then `bun install`. Updates require re-running `bun install` after a rebuild.

---

## Hotkeys

| Key | Action |
| --- | --- |
| `G` | Toggle the whole overlay |
| `1` | Toggle keylines |
| `2` | Toggle columns |
| `3` | Toggle baseline grid |

Keys are ignored while you're typing in an input/textarea/contenteditable, and
require no modifier. Your last on/off state is remembered per-browser
(localStorage), so it stays how you left it across reloads.

## Non-React / vanilla usage

```ts
import { mount } from "keyline/core";
import { defineKeyline } from "keyline/config";

mount(defineKeyline({ preset: "tailwind" }));
```

Works in Vite, Astro, plain HTML — anywhere with a DOM.
