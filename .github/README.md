# LazyPromise

A LazyPromise is like a Promise, with three differences:

- It has typed errors

- It's lazy and cancelable

- It emits synchronously instead of on the microtask queue.

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

The errors are typed and `.subscribe(...)` function requires that you provide a `handleError` callback unless the type of errors is `never`.

Instead of dot-chaining LazyPromise uses pipes: `pipe(x, foo, bar)` is the same as `bar(foo(x))`. Also, there are small naming differences. That aside, LazyPromise API mirrors that of Promise:

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

You typical code could look something like this (types of all values and errors will be inferred):

```ts
pipe(
  // Create a LazyPromise.
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
  // The return value is treated the same way as for `catchRejection`.
  map(value => ...),
).subscribe(
  (value) => { ... },
  // The type system will only want you to provide this handler if by now the
  // type of `error` is other than `never`.
  (error) => { ... },
);
```

## A few random items to know

- There are utility functions `eager` and `lazy` that convert to and from a regular promise. `eager` takes a LazyPromise and returns a Promise, `lazy` takes a function `async (abortSignal) => ...` and returns a LazyPromise.

- The teardown function will not be called if the promise settles (it's either-or).

- Settling a settled lazy promise or subscribing to a lazy promise in its own teardown function is not allowed (will result in an error).

## Failure channel

Typed errors mean that you don't reject lazy promises by throwing an error, but only by calling `reject`. If you do throw, two things will happen. First, the error will be asynchronously re-thrown so it would be picked up by the browser console, Sentry, Next.js error popup etc. Second, a notification will be sent down a third "failure" channel that exists in addition to the value and error channels. It does not pass along the error, but just tells subscribers that there is no resolve or reject forthcoming:

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
      fail();
      throw error;
    }
  });
});

// `handleFailure` has signature `() => void`.
lazyPromise.subscribe(handleValue, handleError, handleFailure);
```

There is `catchFailure` function analogous to `catchRejection`.

## Experimental SolidJS bindings

https://github.com/lazy-promise/lazy-promise/tree/main/packages/solid-js

Article: https://dev.to/ivan7237d/cancelable-async-tasks-and-typed-server-errors-with-solidjs-and-lazypromise-1la
