# Changelog

## [@lazy-promise/core@0.0.9](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.9)

- `eager` now takes an optional AbortSignal.

- Exposed `noopUnsubscribe`.

## [@lazy-promise/core@0.0.8](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.8)

- Failure channel now passes on the error.

- `lazy` now passes the native promise's error into the failure channel rather than the rejection channel.

- New function `failed(<error>)`.

## [@lazy-promise/core@0.0.7](https://github.com/lazy-promise/lazy-promise/tree/%40lazy-promise/core%400.0.7)

- `catchError` renamed to `catchRejection`.
