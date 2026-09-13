# Notes for coding agents

Operational knowledge for working in this repo. Design rationale is in
[DESIGN.md](DESIGN.md). User-facing docs are the GitHub READMEs
([.github/README.md](.github/README.md),
[packages/alien-signals/.github/README.md](packages/alien-signals/.github/README.md));
`packages/*/README.md` are NPM stubs.

## Layout

- pnpm workspace + turbo. `packages/core` is the library (`@lazy-promise/core`);
  `packages/alien-signals` is a proof-of-concept of async signals built on it;
  `packages/eslint-config` and `packages/typescript-config` are shared config.
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
