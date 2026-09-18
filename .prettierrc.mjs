import { fileURLToPath } from "node:url";

// Absolute so the tailwind plugin does not resolve it against process.cwd()
// when prettier formats embedded code blocks (filepath is "dummy.ts" there).
const tailwindStylesheet = fileURLToPath(
  new URL("./packages/site/src/styles/global.css", import.meta.url),
);

export default {
  plugins: [
    "prettier-plugin-packagejson",
    "prettier-plugin-astro",
    "prettier-plugin-tailwindcss",
  ],
  tailwindStylesheet,
  overrides: [
    {
      files: "*.astro",
      options: {
        parser: "astro",
      },
    },
  ],
};
