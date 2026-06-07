import type { KeylineConfig } from "../src/types.js";

/**
 * Example committed spec — the "contract" a project declares. An agent (or
 * teammate) reading this file knows: content lives in a 1280px / 12-col grid
 * with 24px safe-area margins, and text sits on a 4px baseline rhythm.
 * Columns adapt per viewport bucket (phone / tablet / desktop).
 */
const config: KeylineConfig = {
  margins: { width: 24, anchor: "content" },
  baseline: { step: 4, emphasizeEvery: 4 },
  columns: {
    phone: { count: 4, gutter: 12 },
    tablet: { count: 8, gutter: 16 },
    desktop: { count: 12, gutter: 16, maxWidth: 1280 },
  },
  startHidden: false, // demo: show immediately, no K press needed
};

export default config;
