# LazyPromise

A LazyPromise is like a Promise, with three differences:

- It's lazy and cancelable

- It has optional typed errors

- It emits synchronously instead of on the microtask queue.

## Philosophy

The ingredients that went into the cauldron were as follows:

- A primitive-based approach: make the simplest possible primitive for the job without attempting to think of all possible use-cases.

- The good and bad parts of the experience of using RxJS. You can't beat Observable for simplicity, but you've got the diamond problem (see 5th section "Reactive Algorithms" in [this article](https://milomg.dev/2022-12-01/reactivity)) and [undesirable behavior in the case of sync re-entry](https://github.com/ReactiveX/rxjs/issues/5174). LazyPromise is what you get if you take an Observable, make it impossible to misuse it for what the Signals were built to do, and then take advantage of the reduced scope to gracefully handle re-entry.

- Desire to avoid mandatory microtasks. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more `await`s in it (this breaks modularity). Without microtasks, you're in full control over what runs in what order.

- Practical need for typed errors.

## Installation

```bash
npm install @lazy-promise/core
```

## Usage

You create a LazyPromise like you create a Promise, except you can optionally return a teardown function, for example:

```ts
const lazyPromise = new LazyPromise<"a", "error1">((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    if (Math.random() > 0.5) {
      resolve("a");
    } else {
      reject("error1");
    }
  }, 1000);
  return () => {
    clearTimeout(timeoutId);
  };
});
```

Unlike a promise, a lazy promise doesn't do anything until you subscribe to it:

```ts
// `unsubscribe` is an idempotent `() => void` function.
const unsubscribe = lazyPromise.subscribe(handleValue, handleError);
```

Besides being lazy, LazyPromise is cancelable: if the subscriber count goes down to zero before the promise has had time to fire, the teardown function will be called and we'll be back to square one.

If a lazy promise does fire, then like a regular promise it will remember forever the value or error, and give it to whoever tries to subscribe in the future.

Aside from some small naming differences, LazyPromise API mirrors that of Promise:

| Promise api                       | LazyPromise equivalent                       |
| :-------------------------------- | :------------------------------------------- |
| `promise.then(foo)`               | `lazyPromise.pipe(map(foo))`                 |
| `promise.catch(foo)`              | `lazyPromise.pipe(catchRejection(foo))`      |
| `promise.finally(foo)`            | `lazyPromise.pipe(finalize(foo))`            |
| `Promise.resolve(valueOrPromise)` | `box(valueOrLazyPromise)`                    |
| `Promise.reject(error)`           | `rejected(error)`                            |
| `new Promise<never>(() => {})`    | `never`                                      |
| `Promise.all(...)`                | `all(...)`                                   |
| `Promise.any(...)`                | `any(...)`                                   |
| `Promise.race(...)`               | `race(...)`                                  |
| `Promise<Value>`                  | `LazyPromise<Value, Error>`                  |
| `Awaited<T>`                      | `LazyPromiseValue<T>`, `LazyPromiseError<T>` |

Your typical code could look something like this (types of all values and errors will be inferred, and callbacks are guaranteed to not be called once you unsubscribe):

```ts
lazyPromise.pipe(
  // Mirrors the behavior of `promise.catch(...)`.
  catchRejection((error) => {
    // To turn the error into a value, return that value.
    //
    // To turn the error into another error, return `rejected(newError)`.
    //
    // To perform some side effect and have the resulting promise never fire,
    // return `never`.
    ...
  }),
  // Mirrors the behavior of `promise.then(...)`.
  map((value) => ...),
).subscribe(
  // This handler is always optional.
  (value) => ...,
  // TypeScript will only want you to provide this handler if by now the type
  // of `error` is other than `never`.
  (error) => ...,
);
```

## A few things to know

- The teardown function will not be called if the promise settles (it's either-or).

- Illegal operations, such as settling an already settled lazy promise, throw an error rather than failing silently.

- An easy way to tell whether a lazy promise has settled synchronously when you subscribed is to check if the unsubscribe handle `=== noopUnsubscribe`.

## Failure channel

Since the type system doesn't know what errors a function can throw, you don't reject a lazy promise by throwing an error, but only by calling `reject`. It's still possible however that an error will be thrown due to a bug, and for that there exists a third "failure" channel, which is much like the rejection channel, but deals with untyped errors, for instance failed assertions.

```ts
// `handleFailure` is always optional and has signature `(error: unknown) => void`.
lazyPromise.subscribe(handleValue, handleError, handleFailure);
```

Besides throwing in the callbacks you pass to LazyPromise constructor, `fromEager`, `map`, etc., you can also fail a lazy promise using the `fail` handle:

```ts
// `fail` has signature `(error: unknown) => void`.
const lazyPromise = new LazyPromise((resolve, reject, fail) => {
  // Throwing here is the same as calling `fail`.

  // If you throw in setTimeout, LazyPromise will have no way of
  // knowing about it, so `fail` has to be called explicitly.
  setTimeout(() => {
    try {
      ...
    } catch (error) {
      fail(error);
    }
  });
});
```

There are `catchFailure` and `failed` utilities analogous to `catchRejection` and `rejected`.

The failure channel makes typed errors an optional feature: you can easily use the library with all your promises typed as `LazyPromise<Value, never>`.

## Utilities

- `toEager` converts a LazyPromise to a Promise, `fromEager` converts an async function to a LazyPromise. Both utilities support AbortSignal API.

- There are convenience wrappers for browser and Node deferral APIs: `inTimeout`, `inMicrotask`, `inAnimationFrame`, `inIdleCallback`, `inImmediate`, `inNextTick`. Each of these returns a lazy promise that fires in respectively `setTimeout`, `queueMicrotask` etc. If you wrote `try { return 1 } finally { await x }`, this would produce a promise that waits for `x`, then resolves with 1. In the same way, piping a lazy promise through `finalize(() => inTimeout(ms))` delays it by `ms`, or piping it through `finalize(inMicrotask)` makes it settle in a microtask.

- `log` function wraps a lazy promise without changing its behavior, and console.logs everything that happens to it: `lazyPromise.pipe(log("your label"))`.

## Async-await syntax

You cannot `await` a lazy promise, but you can return one from an async function, and that makes it easy to have typed errors when working with Promise-based APIs:

```ts
// Type inferred as LazyPromise<"a", "error1">
const lazyPromise = fromEager(async () => {
  if (await someNativePromise) {
    return rejected("error1");
  }
  return "a";
});
```

## Generator syntax

This is a full LazyPromise equivalent of async-await. Just use generator functions instead of async functions, and `yield*` instead of `await`:

```ts
// Type inferred as LazyPromise<"b", "error1" | "error2">
const lazyPromise = fromGenerator(function* () {
  // Type inferred as "a" | "b"
  const value = yield* new LazyPromise<"a" | "b", "error1">(() => {});
  if (value === "a") {
    // `yield*` would have worked too, but `return` tells TypeScript that the
    // execution stops so it can narrow down the type of `value`.
    return rejected("error2");
  }
  return value;
});
```
