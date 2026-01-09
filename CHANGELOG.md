# Changelog

## [@lazy-promise/core@0.0.15](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.15)

- Allow passing no argument to `resolved`/`rejected`/`failed`.

## [@lazy-promise/core@0.0.14](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.14)

- Wrappers for browser/Node deferral APIs.

- Handling of a promise returned by a `finalize` callback is now consistent with native promise.

- `log` utility.

- `pipe` added to core to save the hassle of installing an extra package.

## [@lazy-promise/core@0.0.13](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.13)

- `eager` now expects a lazy promise that doesn't reject.

- Better error handling when a lazy promise rejects despite having errors typed as `never`.

## [@lazy-promise/core@0.0.12](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.12)

- Fix handling of unsubscribe in map/catchRejection/catchFailure/finalize callbacks.

## [@lazy-promise/core@0.0.11](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.11)

- Fix identity of the disposal handle returned by `never`.

## [@lazy-promise/core@0.0.10](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.10)

- `resolved("a")` is now inferred as `LazyPromise<"a", never>`, not `LazyPromise<string, never>`. Same for `rejected`.

## [@lazy-promise/core@0.0.9](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.9)

- `eager` now takes an optional AbortSignal.

- Exposed `noopUnsubscribe`.

## [@lazy-promise/core@0.0.8](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.8)

- Failure channel now passes on the error.

- `lazy` now passes the native promise's error into the failure channel rather than the rejection channel.

- New function `failed(<error>)`.

## [@lazy-promise/core@0.0.7](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.7)

- `catchError` renamed to `catchRejection`.
