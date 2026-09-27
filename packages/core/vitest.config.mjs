import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    execArgv: ["--expose-gc"],
    coverage: {
      // Which branch runs depends on the Node version.
      exclude: ["build/module/disposeSymbol.js"],
    },
  },
  resolve: {
    alias: {
      "@lazy-promise/core": __dirname,
    },
  },
});
