import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import pagefind from "astro-pagefind";

// Both github themes color comments #6a737d; use the site's muted ink instead.
const commentColor = "#6a737d";

const mutedComments = {
  name: "muted-comments",
  tokens(lines) {
    for (const line of lines) {
      for (const token of line) {
        const style = token.htmlStyle;
        if (!style) {
          continue;
        }
        for (const key of Object.keys(style)) {
          if (style[key].toLowerCase() === commentColor) {
            style[key] = "var(--ink-muted)";
          }
        }
      }
    }
  },
};

export default defineConfig({
  site: "https://lazypromise.com",
  trailingSlash: "always",
  integrations: [mdx(), react(), sitemap(), pagefind()],
  prefetch:
    process.env.NODE_ENV === "production"
      ? {
          prefetchAll: true,
          defaultStrategy: "hover",
        }
      : false,
  experimental: {
    clientPrerender: true,
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
      transformers: [mutedComments],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
