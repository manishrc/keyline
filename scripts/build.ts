/**
 * Build the package to dist/ as ESM.
 *
 * Two passes:
 *  1) bun build  — bundle each entry point to ESM JS. React stays external so the
 *     host app's React is used (see peerDependencies).
 *  2) tsc        — emit .d.ts declarations only (bun build doesn't do types).
 *
 * Run: bun run build
 */

import { rmSync } from "node:fs";
import { $ } from "bun";

rmSync("dist", { recursive: true, force: true });

/**
 * `bun build` concatenates modules and does NOT hoist a `"use client"` directive
 * to the top of the output — it ends up buried mid-file, where Next.js ignores
 * it. The directive is only meaningful as the FIRST statement of the file. So we
 * strip any inlined copies and prepend exactly one at the top, post-bundle.
 */
async function fixUseClient(path: string): Promise<void> {
  const file = Bun.file(path);
  let code = await file.text();
  code = code.replace(/^\s*["']use client["'];?\s*$/gm, "");
  await Bun.write(path, `"use client";\n${code.replace(/^\n+/, "")}`);
}

const result = await Bun.build({
  entrypoints: ["src/core.ts", "src/config.ts", "src/react.tsx"],
  outdir: "dist",
  target: "browser",
  format: "esm",
  // Do not inline React — the consuming app provides it.
  external: ["react", "react-dom", "react/jsx-runtime"],
  // Keep the output readable; this is a dev tool, not perf-critical shipped code.
  minify: false,
  sourcemap: "external",
});

if (!result.success) {
  console.error("Build failed:");
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`✓ bundled ${result.outputs.length} files`);

// React entry must carry "use client" as its first line for Next.js App Router.
await fixUseClient("dist/react.js");
console.log('✓ hoisted "use client" in react.js');

// Emit type declarations.
await $`tsc -p tsconfig.build.json`;
console.log("✓ emitted .d.ts declarations");
