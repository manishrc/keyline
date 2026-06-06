import { defineConfig } from "vite";

// Serves the local demo. The library itself is built with `bun run build`,
// not Vite — this config is only for the visual playground in /demo.
export default defineConfig({
  root: ".",
  server: { port: 5733, open: "/demo/" },
});
