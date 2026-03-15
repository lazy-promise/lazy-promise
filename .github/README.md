# LazyPromise

A LazyPromise is like a Promise, except

- Like an Observable (or more exactly a Single in RxJava), it's lazy, cancelable, and emits synchronously instead of in a microtask.

- It supports typed errors.

## Philosophy

The ingredients that went into the cauldron were as follows:

- A primitive-based approach: make the simplest possible primitive for the job without attempting to think of all possible use-cases.

- The good and bad parts of the experience of using RxJS. You can't beat Observable for simplicity, but you've got the [diamond problem](https://stackblitz.com/edit/rxjs-diamond-problem-s8cy9zzb?devToolsHeight=33&file=index.ts) and [undesirable behavior in the case of sync reentry](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=33&file=index.ts). LazyPromise is what you get if you take an Observable, make it impossible to misuse it for what the Signals were built to do, and then take advantage of the reduced scope to make it reentry-proof.

- Desire to avoid mandatory microtasks. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more `await`s in it. To decide whether you want microtasks, you'd have to weight the benefits against the costs from the point of view of various use-cases. You can do that, or you can just pick the simpler one of the two alternatives.

- Practical need for typed errors.

## Installation

```bash
npm install @lazy-promise/core
```

## Usage

You create a LazyPromise like you create a native Promise, except you have a `subscriber` object instead of `resolve, reject` pair, and you can optionally return a teardown function:

```ts
const lazyPromise = new LazyPromise<"value">((subscriber) => {
  const timeoutId = setTimeout(() => {
    if (...) {
      subscriber.resolve("value");
    } else {
      subscriber.reject("error");
    }
  }, 1000);
  return () => {
    clearTimeout(timeoutId);
  };
});
```

Whereas a native Promise executes eagerly and retains the result once it settles, a LazyPromise behaves like an Observable. The way to think of it is `new LazyPromise(foo)` is simply `foo` with a wrapper around it that's only there to enforce a few invariants:

- Nothing gets emitted after you unsubscribe

- If something does get emitted, that only happens once

- The teardown function is run at most once, and only if nothing was emitted

- There can be no higher-order LazyPromise (a LazyPromise that resolves to a LazyPromise).

Just like a function doesn't do anything until you call it, a LazyPromise doesn't do anything until you subscribe to it:

```ts
const subscription = lazyPromise.subscribe({resolve: (value) =>..., reject: (error) => ...});
```

To cancel the subscription, you call

```ts
// This method is idempotent.
subscription.unsubscribe();
```

Aside from some superficial differences, LazyPromise API mirrors that of native Promise:

| Promise api                       | LazyPromise equivalent                  |
| :-------------------------------- | :-------------------------------------- |
| `promise.then(foo)`               | `lazyPromise.pipe(map(foo))`            |
| `promise.catch(foo)`              | `lazyPromise.pipe(catchRejection(foo))` |
| `promise.finally(foo)`            | `lazyPromise.pipe(finalize(foo))`       |
| `Promise.resolve(valueOrPromise)` | `box(valueOrLazyPromise)`               |
| `Promise.reject(error)`           | `rejecting(error)`                      |
| `new Promise<never>(() => {})`    | `never`                                 |
| `Promise.all(...)`                | `all(...)`                              |
| `Promise.any(...)`                | `any(...)`                              |
| `Promise.race(...)`               | `race(...)`                             |
| `Awaited<T>`                      | `Flatten<T>`                            |

LazyPromise API does not just resemble the native Promise API, but follows all its subtleties unless stated otherwise in the docs. In particular, if you call the `resolve` handle of a native `Promise` with a `Promise<string>` as an argument, you'll end up with `Promise<string>`, not `Promise<Promise<string>>`. LazyPromise is similarly flattened.

## Typed errors

Whereas untyped errors are represented by rejections, typed errors are represented by instances of `TypedError<YourError>` class that a lazy promise resolves to. `new TypedError(<your error>)` creates an object that simply stores `<your error>` as its `.error` property, and is treated differently from other values by LazyPromise API:

- If you subscribe to a lazy promise that can resolve to a typed error, the type system will want you to provide a `resolve` handler.

- `map`, `all`, and `race` operators pass typed errors through, the same way they pass through rejections.

- There is an operator `catchTypedError` that does for typed errors what `catchRejection` does for rejections.

Typed errors are optional in the sense that you can forget about them if you don't use `TypedError` class, but there is one exception to that, and that's the `any` operator. When one of the promises passed to the native `Promise.any` rejects because of a bug, the bug ends up unnoticed if another of the input promises resolves. The lazy promise version of `any` works like `Promise.any` when it comes to typed errors, but rejects if even one of the inputs rejects.

## Utilities

- `toEager` converts a LazyPromise to a Promise, `fromEager` converts an async function to a LazyPromise. Both utilities support AbortSignal API.

- Wrappers for browser and Node deferral APIs: `inTimeout`, `inMicrotask`, `inAnimationFrame`, `inIdleCallback`, `inImmediate`, `inNextTick`, `inMessageChannel`, `inScheduled`. Each of these returns a lazy promise that fires, typically with a value of `undefined`, in respectively `setTimeout`, `queueMicrotask` etc. Since these are non-imaginative convenience wrappers for native APIs, they don't add much complexity to the API surface, yet they remove the need for some extra constructs you'd normally find in libraries that deal with async. Take the use-case of delaying a lazy promise. With native promises, you could write

  ```ts
  try {
    return originalPromise;
  } finally {
    await anotherPromise;
  }
  ```

  and this would wait for `anotherPromise` before passing on the result of `originalPromise`. You can delay a lazy promise by just repeating this logic:

  ```ts
  originalLazyPromise.pipe(finalize(() => anotherLazyPromise));
  ```

  If `anotherLazyPromise` is `inTimeout(ms)`, that would delay `originalLazyPromise` by `ms`. If `anotherLazyPromise` is `inMicrotask()`, that would make `originalLazyPromise` settle in a microtask.

- `log` function wraps a lazy promise without changing its behavior, and console.logs everything that happens to it: `lazyPromise.pipe(log("your label"))`.

## Async-await syntax

You cannot `await` a lazy promise, but there is nothing stopping you from returning a `TypedError` from an async function, and that makes it easy to have typed errors when working with Promise-based APIs:

```ts
// Type inferred as LazyPromise<Data | TypedError<number>>
const lazyPromise = fromEager(async ({ signal }) => {
  const response = await fetch("https://...", { signal });
  if (!response.ok) {
    return new TypedError(response.status);
  }
  return (await response.json()) as Data;
});
```

## Generator syntax

This is a full LazyPromise equivalent of async-await. Just use generator functions instead of async functions, and `yield*` instead of `await`:

```ts
// Type inferred as LazyPromise<"b">
const lazyPromise = fromGenerator(function* () {
  // Type inferred as "a"
  const value = yield* new LazyPromise<"a">(...);
  return "b" as const;
});
```

When you `yield*` to a lazy promise and that lazy promise rejects, the same thing happens as when you `await` a native promise and the native promise rejects: there is an error thrown which you can catch. Typed errors, on the other hand, are treated as any other values that a lazy promise can resolve to.

Consistently with the `finalize` operator, a `finally` block does not execute if the lazy promise returned by `fromGenerator` is torn down before reaching it. If you don't `yield*` inside `try`/`catch`, you keep the guarantee that `finally` will run no matter what.

## Class-based API

To get maximum performance, for instance when working on a library, you can avoid creating functions by using class instances in their place. Instead of passing a callback to `LazyPromise` constructor, you can pass a `Producer` instance with `.produce` method on it, and instead of returning a teardown function, you can return an `InnerSubscription` instance with `.unsubscribe` method.
