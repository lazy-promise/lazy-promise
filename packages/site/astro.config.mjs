import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import pagefind from "astro-pagefind";

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
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
