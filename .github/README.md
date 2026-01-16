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
const lazyPromise = new LazyPromise<0, "oops">((resolve, reject) => {
  const timeoutId = setTimeout(() => {
    if (Math.random() > 0.5) {
      resolve(0);
    } else {
      reject("oops");
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

Instead of dot-chaining LazyPromise uses pipes (`pipe(x, foo, bar)` is `bar(foo(x))`), and there are small naming differences, but that aside, LazyPromise API mirrors that of Promise:

| Promise api                    | LazyPromise equivalent                       |
| :----------------------------- | :------------------------------------------- |
| `promise.then(foo)`            | `pipe(lazyPromise, map(foo))`                |
| `promise.catch(foo)`           | `pipe(lazyPromise, catchRejection(foo))`     |
| `promise.finally(foo)`         | `pipe(lazyPromise, finalize(foo))`           |
| `Promise.resolve(value)`       | `resolved(value)`                            |
| `Promise.reject(error)`        | `rejected(error)`                            |
| `new Promise<never>(() => {})` | `never`                                      |
| `Promise.all(...)`             | `all(...)`                                   |
| `Promise.any(...)`             | `any(...)`                                   |
| `Promise.race(...)`            | `race(...)`                                  |
| `Promise<Value>`               | `LazyPromise<Value, Error>`                  |
| `Awaited<T>`                   | `LazyPromiseValue<T>`, `LazyPromiseError<T>` |

Your typical code could look something like this (types of all values and errors will be inferred, and callbacks are guaranteed to not be called once you unsubscribe):

```ts
pipe(
  // Create a LazyPromise<Value, Error>.
  callAnApiEndpoint(params),
  // Handle some errors.
  catchRejection(error => {
    // To turn the error into a value, return that value.

    // To turn the error into another error, return `rejected(newError)`, which
    // will have type LazyPromise<never, NewError>.

    // To perform some side effect and have the resulting promise never fire,
    // return `never` which has type LazyPromise<never, never>.
    ...
  }),
  // The return value of the callback is treated the same way as for `catchRejection`,
  // so again, you can return either a value or a LazyPromise.
  map(value => ...),
).subscribe(
  // This handler is always optional.
  (value) => { ... },
  // The type system will only want you to provide this handler if by now the
  // type of `error` is other than `never`.
  (error) => { ... },
);
```

## A few things to know

- The teardown function will not be called if the promise settles (it's either-or).

- Illegal operations, such as settling an already settled lazy promise, throw an error rather than failing silently.

- An easy way to tell whether a lazy promise has settled synchronously when you subscribed is to check if the unsubscribe handle `=== noopUnsubscribe`.

## Utilities

- Functions `eager` and `lazy` convert to and from a regular promise. `eager` takes a LazyPromise and an optional AbortSignal, and returns a Promise, `lazy` takes a function `async (abortSignal) => ...` and returns a LazyPromise.

- There are convenience wrappers for browser/Node deferral APIs: `timeout`, `microtask`, `animationFrame`, `idleCallback`, `immediate`, `nextTick`. Each of these is a function returning a lazy promise that fires in respectively `setTimeout`, `queueMicrotask` etc. Since like the native `.finally`, `finalize` waits for the promise if its callback returns one (think `try { ... } finally { await ... }`), you can delay a lazy promise by piping it through `finalize(() => timeout(ms))`, or make it settle in a microtask with `finalize(microtask)`.

- `log` function wraps a lazy promise without changing its behavior, and console.logs everything that happens to it: `pipe(lazyPromise, log("your label"))`.

## Failure channel

Since the type system doesn't know what errors a function can throw, you don't reject a lazy promise by throwing an error, but only by calling `reject`. It's still possible however that an error will be thrown due to a bug, and for that there exists a third "failure" channel, which is much like the rejection channel, but deals with untyped errors, for instance failed assertions.

```ts
// `handleFailure` is always optional and has signature `(error: unknown) => void`.
lazyPromise.subscribe(handleValue, handleError, handleFailure);
```

Besides throwing in the callbacks you pass to LazyPromise constructor, `lazy`, `map`, etc., you can also fail a lazy promise using the `fail` handle:

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

## Experimental SolidJS bindings

https://github.com/lazy-promise/lazy-promise/tree/main/packages/solid-js
