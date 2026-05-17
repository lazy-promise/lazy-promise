import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { execArgv: ["--expose-gc"] },
  resolve: {
    alias: {
      "@lazy-promise/alien-signals": __dirname,
    },
  },
});
