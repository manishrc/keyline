/**
 * Minimal ambient declaration for the one Node-ish global we read.
 *
 * We deliberately do NOT depend on @types/node: this is a browser library, and
 * pulling Node's full type surface would let `fs`, `Buffer`, etc. autocomplete
 * where they don't belong. Bundlers (Next, Vite, webpack) statically replace
 * `process.env.NODE_ENV` at build time, so this is the only member that exists.
 */
declare const process: {
  env: {
    NODE_ENV?: "development" | "production" | "test" | (string & {});
  };
};
