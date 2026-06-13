# Using `keyline` in your Next.js apps (locally, before/without npm)

This gets the overlay running in another local project in ~2 minutes, with live
updates: edit keyline here → rebuild → see changes in your app on refresh.

> **What you get:** press **`K`** to toggle the alignment overlay, then
> **`M`/`C`/`B`/`L`/`R`** for margins / columns / baseline / lines / rulers and
> **`?`** for the shortcut panel. Dev-only — it compiles out of production builds.

---

## Option A: tarball (what audiclip uses)

From `keyline/`:

```sh
bun run build
bun pm pack        # → @manishrc/keyline-0.3.0.tgz (gitignored)
```

In the app's `package.json`:

```json
{ "dependencies": { "@manishrc/keyline": "file:../keyline/manishrc-keyline-0.3.0.tgz" } }
```

then `bun install`. After each keyline change: rebuild, repack, and re-run
`bun pm cache rm; bun install` in the app.

## Option B: `bun link`

From `keyline/`:

```sh
bun run build      # produce dist/
bun link           # registers "@manishrc/keyline" globally
```

From each app root:

```sh
bun link @manishrc/keyline
```

Re-run `bun run build` after changing keyline's source.

## Drop `<Keyline />` into the root layout

App Router — `app/layout.tsx`:

```tsx
import { Keyline } from "@manishrc/keyline";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        {process.env.NODE_ENV === "development" && (
          <Keyline
            margins={{ width: 24, anchor: "content" }}
            baseline={{ step: 4, emphasizeEvery: 4 }}
            columns={{
              phone: { count: 4, gutter: 12 },
              tablet: { count: 8, gutter: 16 },
              desktop: { count: 12, gutter: 16, maxWidth: 1280 },
            }}
          />
        )}
      </body>
    </html>
  );
}
```

Then mark each page's content container:

```tsx
<div className="mx-auto max-w-2xl" data-keyline="content">
```

`<Keyline />` is a client component (it ships `"use client"`), renders `null`,
and mounts a fixed overlay layer it manages itself. It does **not** disturb
your layout or your React tree, and it's a no-op when
`NODE_ENV === "production"`.

That's it. Run `bun dev`, load any page, press **`K`**.

---

## If linking fights you: the "two Reacts" error

`bun link` symlinks keyline's folder, which can contain its own React copy.
Next may then bundle **two Reacts** → `Invalid hook call`. Fix in
`next.config.ts`:

```ts
const nextConfig = {
  transpilePackages: ["@manishrc/keyline"],
};
export default nextConfig;
```

The tarball method (Option A) avoids this entirely — that's why it's first.

## Non-React / vanilla usage

```ts
import { mount } from "@manishrc/keyline/core";

mount({ margins: { width: 24, anchor: "content" }, baseline: { step: 4 } });
```

Works in Vite, Astro, plain HTML — anywhere with a DOM.
