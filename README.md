# LazyPromise

## About

LazyPromise is an async primitive that has familiar semantics of a native promise, but supports auto-propagating cancellation, type-safe errors, and dependency injection.

## Prior art

### Observable

[Observable](https://rxjs.dev/) is beautifully simple and auto-propagates cancellation. LazyPromise makes sure to keep that, but limits Observable to a single shot—you could say it's a JavaScript cousin of a Single in RxJava. A single-shot Observable [nicely complements Signals](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals) and doesn't have [synchronous reentry gotchas](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=50&file=index.ts).

### Native promise

The native promise is eager and needs AbortController plumbing for cancellation, but in other respects its API is great. The LazyPromise API doesn't just resemble the native promise API, but follows all its subtleties unless stated otherwise in the docs. This has a happy byproduct of making the library easier to document and learn.

### Effect

Like [Effect](https://www.effect), and as any self-respecting lazy promise should, LazyPromise supports generator syntax, type-safe errors, and dependency injection, but does so while staying simple.

## Documentation

[lazypromise.com](https://lazypromise.com/basic-usage/)

## Contributing

Issues/PRs/discussions welcome. The tests import from locally built output instead of directly from the source, so after checking out the repo, run `turbo build`. To test, run `turbo test`. To build irrespective of TS errors, run `turbo build:force`. These commands assume that you have Turborepo installed globally (`npm install turbo --global`).
