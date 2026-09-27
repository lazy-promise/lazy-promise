import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lazy-promise/interop": __dirname,
    },
  },
});
