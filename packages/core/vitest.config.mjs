import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { execArgv: ["--expose-gc"] },
  resolve: {
    alias: {
      "@lazy-promise/core": __dirname,
    },
  },
});
