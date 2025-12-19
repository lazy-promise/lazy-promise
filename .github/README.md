# LazyPromise

A LazyPromise is like a Promise, with three differences:

- It's lazy and cancelable

- It has typed errors

- It emits synchronously instead of on the microtask queue.

## Philosophy

The ingredients that went into the cauldron were as follows:

- A primitive-based approach: make the simplest possible primitive for the job without attempting to think of all possible use-cases.

- The good and bad parts of the experience of using RxJS. You can't beat Observable for simplicity, but you've got the diamond problem and [undesirable behavior in the case of sync re-entry](https://github.com/ReactiveX/rxjs/issues/5174). In a way LazyPromise is what you get if you take an Observable and make it impossible to misuse it for what the Signals were built to do.

- Desire to avoid mandatory microtasks. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more awaits in it (this breaks modularity).

- Practical need for typed errors.

## Installation

```bash
npm install @lazy-promise/core pipe-function
```

In the above snippet, `pipe-function` [package](https://github.com/ivan7237d/pipe-function) provides the `pipe` function, but there is nothing special about it and you can use the same function from another library. `pipe(x, foo, bar)` is `bar(foo(x))`.

## Usage

You create a LazyPromise much like you call the Promise constructor, except you can optionally return a teardown function, for example:

```ts
const lazyPromise = createLazyPromise<0, "oops">((resolve, reject) => {
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

Instead of dot-chaining LazyPromise uses pipes, and there are small naming differences, but that aside, LazyPromise API mirrors that of Promise:

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
| `x instanceof Promise`         | `isLazyPromise(x)`                           |
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

## A few random items to know

- There are utility functions `eager` and `lazy` that convert to and from a regular promise. `eager` takes a LazyPromise and an optional AbortSignal, and returns a Promise, `lazy` takes a function `async (abortSignal) => ...` and returns a LazyPromise.

- The teardown function will not be called if the promise settles (it's either-or).

- Illegal operations, such as settling an already settled lazy promise, throw an error rather than failing silently.

- An easy way to tell whether a lazy promise has settled synchronously when you subscribed is to check if the unsubscribe handle `=== noopUnsubscribe`.

## Failure channel

Since the type system doesn't know what errors a function can throw, you don't reject a lazy promise by throwing an error, but only by calling `reject`. It's still possible however that an error will be thrown due to a bug, and for that there exists a third "failure" channel, which is much like the rejection channel, but deals with untyped errors, for instance failed assertions.

```ts
// `handleFailure` is always optional and has signature `(error: unknown) => void`.
lazyPromise.subscribe(handleValue, handleError, handleFailure);
```

Besides throwing in the callbacks you pass to `createLazyPromise`, `lazy`, `map`, etc., you can also fail a lazy promise using the `fail` handle:

```ts
// `fail` has signature `() => void`.
const lazyPromise = createLazyPromise((resolve, reject, fail) => {
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

## Experimental SolidJS bindings

https://github.com/lazy-promise/lazy-promise/tree/main/packages/solid-js ([article](https://dev.to/ivan7237d/cancelable-async-tasks-and-typed-server-errors-with-solidjs-and-lazypromise-1la))
