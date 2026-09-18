# Notes for coding agents

Operational knowledge for working in this repo. Design rationale is in
[DESIGN.md](DESIGN.md). User-facing docs live on the site
(`packages/site`, deployed to https://lazypromise.com); the root
[README.md](README.md) and `packages/core/README.md` only point there.
alien-signals docs stay on GitHub
([packages/alien-signals/.github/README.md](packages/alien-signals/.github/README.md));
`packages/alien-signals/README.md` is an NPM stub. `packages/site/README.md`
has the site's own operational notes.

## Layout

- pnpm workspace + turbo. `packages/core` is the library (`@lazy-promise/core`);
  `packages/alien-signals` is a proof-of-concept of async signals built on it;
  `packages/site` is the docs site (Astro, private, no `version` so
  `publish.sh` skips it); `packages/eslint-config` and
  `packages/typescript-config` are shared config.
- `temp/` is gitignored scratch space (probe scripts, patches).

## Commands

- Build: `npx turbo build:force` from the root. `build:force` emits even with
  type errors (`--noEmitOnError false || true`), so `build/types` is always
  refreshed. Turbo hashes package files, so source edits invalidate the cache;
  pass `--force` only after editing the shared config packages
  (`typescript-config`, `eslint-config`), which have no build task and so do
  not feed into dependents' hashes.
- Test everything: `npx turbo test`. Runs eslint, `tsc` (type tests), vitest,
  and a root prettier check (`prettier --list-different '**'`). Run
  `npx prettier --write <files>` on anything you edit or the check fails.
- Per package: `npx vitest run [file]`, `npx tsc` (noEmit), and
  `npx eslint . --max-warnings=0`.
- Coverage: tests execute `build/module`, not `src`, so run
  `npx vitest run --coverage --coverage.reporter=text --coverage.include='build/module/**'`
  in `packages/core` after a rebuild (coverage on `src/**` reports 0%).
  Coverage is 100% and must stay there; if a line ever has to be exempt,
  still run the report and check for regressions elsewhere.
- Benchmarks: `node scripts/bench.mjs [ref] --runs=5 --iterations=300000`
  compares the working tree against a git ref or npm version (default `HEAD`).
  The default iteration count is slow; run one benchmark process at a time.
- Publish: `.github/workflows/publish.yml` runs `scripts/publish.sh` per
  package, publishing when `package.json` version differs from npm and tagging
  `<name>@<version>`.

## Build/typecheck gotcha

- Test files import the package by name (`@lazy-promise/core`). That resolves
  via tsconfig `paths` to the package dir, then via `package.json` `types` to
  the compiled `build/types/*.d.ts`, not `src/`. After editing `src`, rebuild
  before type-checking or inspecting types in tests, or you will debug stale
  types.
- vitest transpiles with esbuild and does not type-check. `expectTypeOf` and
  `@ts-expect-error` tests only fail under `tsc`.
- Vite's SSR transform (vitest) snapshots imported bindings that are referenced
  in class field initializers into a `const` before the class, so a mutable
  export (`activeSpans` in `trace.ts`) read there is stale under vitest but
  fine in Node. Read such bindings in the constructor body instead.
- `build/` is gitignored; deleting it is always safe.
- Editor-only or CLI-only type errors are usually TS version skew (bundled VS
  Code TS vs the workspace one) or check-order dependent variance validation;
  see DESIGN.md.

## Conventions

- ESM sources; `tsc` emits `build/module` + `build/types`, babel emits CJS to
  `build/main`. ESLint config is `.eslintrc.cjs` per package.
- `LICENSE` is a committed copy in each package (npm pack does not include the
  root file and strips symlinks).
- Naming: `Sink` is the object passed to a producer (`sink.resolve/reject`);
  `Consumer` is the object passed to `.subscribe`; `Producer` is an object with
  `.produce`; `Job` is the disposable a producer returns (teardown);
  "subscription" is the disposable returned by `.subscribe()`. Classes follow
  `XxxConsumer`, `XxxJob`, and `XxxConsumerJob` when one object plays both
  roles.
- Style: early returns over `else`; no abbreviated names; minimal comments,
  especially on type-level code (the author prefers experimenting with types
  to reading prose about them).
- Hot paths avoid closures: a method containing an arrow function, even on a
  branch never taken, makes V8 allocate a context object on every call. Pass
  method references (`runInContext(method, arg)`) instead.
- Tests: flat `test(...)`, `log`/`readLog` helpers, fake timers, inline
  snapshots, one `test("types")` per file with `expectTypeOf` and
  `@ts-expect-error`. `await Promise.resolve()` when a real microtask is
  needed.

## packages/core: type-level traps

- `stripInternal` removes a declaration whose leading comment contains the
  internal JSDoc tag anywhere, including inside `//` comments. Never mention the
  tag above a declaration that must survive `.d.ts` emit. An
  `// eslint-disable-next-line` between an internal-marked doc comment and a
  constructor parameter property leaks the property into the `.d.ts`; use a
  trailing `// eslint-disable-line`.
- `declare protected inferenceHelper: (dep: Dep) => void` on `LazyPromise` is
  load-bearing (see DESIGN.md). `protected`, not `private`: private members
  lose their types in `.d.ts`.
- Methods whose type check depends on `Value` or `Dep` use `this: This` with
  `Unbox<This>` / `InferDep<This>` (`inject`, `toEager`, `trace`, `pipe`).
  Putting `Dep` directly in a method signature changes its measured variance
  and breaks `InferDep` or assignability between instantiations. `this`
  parameters are compared strictly even on methods.
- Type-level behavior can differ between live `src` (relative import) and
  `.d.ts` consumption (package alias). Validate type fixes through the package
  alias; a relative-import probe proves nothing.
- `Extract<T, LazyPromise<any, never>>` matches every LazyPromise (contravariant
  `Dep`). `LazyPromise<any, any>` does not match `LazyPromise<V, never>`.
- Hovers: `Unbox<A> | Unbox<B>` displays resolved; `Unbox<A | B>` shows the
  alias unevaluated. Rebuild before checking hovers.
- Error-message types: a string literal type (`This & "❌ ..."`) renders the
  ❌; a string-literal key in an object type is printed escaped (`\u274C`).
- `fromGen`: `return 42` widens to `number` in `TReturn`; assert `number` in
  type tests.

## packages/alien-signals

- Flushes automatically in a `queueMicrotask`; `flush` is not exported. Tests
  `await Promise.resolve()` after writes. `originalTests/conformance.test.ts`
  needs synchronous writes, so its `write` stubs `globalThis.queueMicrotask` to
  capture and drain the flush.
- Intentionally minimal: not updated for async-context propagation.

## packages/site

- Astro 7 + Tailwind v4 (`@tailwindcss/vite`) + MDX; React islands only for
  interactive bits (`Search`, `Toc`, `ThemeToggle`, `MobileNav`). Pages are
  `src/content/docs/*.mdx`, ordered by the `pageOrder` slug list in `src/docs.ts`;
  `about` is served at `/`. Contributing stays in the root README. Rendered by
  `src/pages/[...slug].astro`; `h2`/`h3` are swapped for `H2`/`H3` components
  to add anchors.
- `pnpm dev` / `pnpm build` / `pnpm preview` in the package. `astro check` and
  eslint (ts/tsx only) run under `turbo test`; `turbo build` builds `dist/`.
  Search is Pagefind, indexed post-build by `astro-pagefind`; in dev it serves
  the last built index; run a build before testing search locally.
- Prefetch is production-only, on hover/focus, with
  `experimental.clientPrerender` so supporting browsers prerender the hovered
  page via Speculation Rules. `ThemeToggle` listens to
  `storage` so hidden prerendered pages pick up theme changes.
- Theme choices are explicit Auto/Light/Dark; Auto follows OS changes.
- Astro 7 gotchas: the Rust compiler rejects unclosed tags; the default
  Markdown pipeline is Sätteri (remark/rehype plugins need
  `@astrojs/markdown-remark` + `processor: unified()`); `compressHTML: 'jsx'`
  strips whitespace between inline elements, use `{" "}`.
- Design tokens are CSS variables in `src/styles/global.css` (`--canvas`,
  `--ink`, `--accent`, ...) mapped into Tailwind via `@theme inline`; dark mode
  is the `.dark` class set by an inline script in `DocsLayout.astro`. Prose
  styles are the `.docs` rules in the same file.
- Logo: squircle path generated with `figma-squircle`
  (`cornerRadius: 128 * 0.2237, cornerSmoothing: 0.6`) on the 128-unit rose
  logo (`#f43f5e` / `#ffe4e6`). PNG assets (`og.png`, icons) are rendered from
  `assets/og.html` / `assets/icon.html` by `pnpm render-assets`
  (`scripts/render-assets.mjs`, playwright-core + installed Chrome); they are
  committed, not built. `apple-touch-icon.png` is deliberately square because
  iOS masks it.
- Deploy: `.github/workflows/site.yml` builds `packages/site` and publishes to
  GitHub Pages on pushes to `main` that touch the site; `public/CNAME` sets the
  custom domain. Root prettier config (`.prettierrc.mjs`) includes
  `prettier-plugin-astro` and `prettier-plugin-tailwindcss`. It is a JS file so
  `tailwindStylesheet` can be absolute: for embedded code blocks in Markdown,
  prettier passes `filepath: "dummy.ts"`, so the tailwind plugin resolves a
  relative stylesheet against `process.cwd()`, fails, and prettier silently
  leaves the block unformatted (the VS Code extension host's cwd is not the
  repo root). Set `PRETTIER_DEBUG=1` to surface such swallowed embed errors.
