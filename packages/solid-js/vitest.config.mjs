import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const solidDir = dirname(require.resolve("solid-js/package.json"));
const signalsDir = dirname(
  createRequire(join(solidDir, "package.json")).resolve(
    "@solidjs/signals/package.json",
  ),
);

export default defineConfig({
  resolve: {
    alias: {
      "@lazy-promise/solid-js": __dirname,
      // Vitest runs in Node, where the "node" condition resolves solid-js to
      // its server build. Force the matched pair of client dev builds instead.
      "solid-js": join(solidDir, "dist/dev.js"),
      "@solidjs/signals": join(signalsDir, "dist/dev.js"),
    },
  },
  test: {
    server: {
      deps: {
        inline: [/solid-js/, /@solidjs/],
      },
    },
  },
});
