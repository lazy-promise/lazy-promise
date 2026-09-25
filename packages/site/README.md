# lazypromise.com

Source of the documentation site, deployed to GitHub Pages by `.github/workflows/site.yml` on pushes to `main` that touch this package.

## Commands

- `pnpm -F site dev`: dev server at http://localhost:4321.

- `pnpm -F site build` / `pnpm -F site preview`: production build into `dist/` and a static server for it.

- `pnpm -F site render-assets`: regenerate `assets/og.png` and the PNG icons from `assets/*.html` (see below).

- `turbo test`: runs `astro check`, eslint and prettier.

## Content

Pages are `src/content/docs/*.mdx`. The nav order is the `pageOrder` list in `src/docs.ts`; every page must appear there exactly once, and `about` is served at `/`.

## Search

Search is Pagefind. The `astro-pagefind` integration runs the indexer over `dist/` as the last step of `pnpm build`. The dev server serves the last built index, so run a build before testing search locally.

## Images

`assets/og.png` (the social card), the PNG icons in `public/` (`icon-512.png`, `icon-192.png`, `apple-touch-icon.png`) and `favicon.ico` are committed files. `pnpm build` never regenerates them. The icons are copied into `dist/` as-is; `og.png` is imported by `DocsLayout.astro` so Astro emits it under `/_astro/` with a content hash in the name, which makes social crawlers (X, etc.) pick up a re-rendered card without waiting for their cache to expire.

They are rendered from `assets/og.html` and `assets/icon.html`. Workflow for changing them:

1. Edit the HTML. Open it in a browser to preview.
2. Run `pnpm -F site render-assets`. It opens each HTML file in your locally installed Chrome (through `playwright-core`, so no browser download), takes a screenshot at the target size, and overwrites the PNG. `favicon.ico` is built the same way: 32 and 16 px screenshots of `icon.html`, packed as PNG entries into an ICO container.
3. Commit both the HTML and the generated files.

Rendering is kept out of the build on purpose: it needs a browser, and font rendering differs between macOS and Linux, so a CI build would produce different PNGs than a local one. The committed files are the source of truth.

`favicon.svg` is maintained by hand.
