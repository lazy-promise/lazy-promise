# LazyPromise

## About

LazyPromise is a conceptually simple primitive that supports auto-propagating cancellation, type-safe errors, and dependency injection. It draws upon ideas from [RxJS](https://rxjs.dev/), native promise and [Effect](https://www.effect.website/). [Signals](https://www.npmjs.com/package/@solidjs/signals) have also helped shape its design by showing where the province of an async primitive ends. There are three ways you can look at it.

### A single-shot Observable

Observable is beautifully simple, and has a great cancellation mechanism. LazyPromise takes care to keep that, but limits Observable to a single shot—you could say it's a JavaScript cousin of a Single in RxJava. A single-shot Observable [nicely complements Signals](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals) and doesn't have [synchronous reentry gotchas](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=50&file=index.ts).

### A lazy, cancellation-propagating promise with an otherwise familiar API

A native promise is eager and needs AbortController plumbing for cancellation, but in other respects its API is great. The LazyPromise API doesn't just resemble the native promise API, but follows all its subtleties unless stated otherwise in the docs. This has a happy side effect of making the library easier to document and learn.

### A tiny Effect

Like Effect, and as any self-respecting lazy promise should, LazyPromise supports generator syntax, type-safe errors, and dependency injection, but does so while staying simple.

## Documentation

[lazypromise.com](https://lazypromise.com/basic-usage/)

## Contributing

Issues/PRs/discussions welcome. The tests import from locally built output instead of directly from the source, so after checking out the repo, run `turbo build`. To test, run `turbo test`. To build irrespective of TS errors, run `turbo build:force`. These commands assume that you have Turborepo installed globally (`npm install turbo --global`).
