# LazyPromise

A LazyPromise is like a Promise, except

- Like an Observable, it's lazy, cancelable, and emits synchronously instead of in a microtask.

- It supports typed errors.

## Installation

```bash
npm install @lazy-promise/core
```

## Motivation

### If you start with Observable

Observable is beautifully simple conceptually, and has a great cancellation mechanism. LazyPromise keeps all that, but limits Observable to a single shot - you could say it's a JavaScript cousin of a Single in Rx Java. The reason it does it is that a multi-shot Observable can be used to represent state, and as Signals have shown, what you want for state is a push-pull system, not a push-only primitive like an Observable. Specifically, if you use Observable you end up with the [Diamond Problem](https://stackblitz.com/edit/rxjs-diamond-problem-s8cy9zzb?devToolsHeight=50&file=index.ts) and [undesirable behavior in the case of sync reentry](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=50&file=index.ts). By limiting itself to a single shot, LazyPromise focuses just on the async, and is intended to be used together with a state library, whether Signals-based or otherwise (here's a proof-of-concept async signals [library](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals) built on top of LazyPromise and alien-signals).

### If you start with a native promise

What's been said above sounds like all the more reason to use the native promise, but there's a catch, three of them actually, one major and two minor.

First of all, good luck using AbortSignal API for cancellation. It's not the specifics of that API though that lie at the heart of the problem here, but just the fact that Promise is eager.

Second, like Observable treads on state management territory by being multi-shot, Promise does the same by storing and multi-casting its result, and you again have the Diamond Problem.

Third, LazyPromise takes the view that microtasks should not be mandatory. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this "Zalgo" guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more `await`s in it. Additionally, by not using microtasks LazyPromise [outperforms](https://stackblitz.com/edit/long-running-tasks?devToolsHeight=50&file=index.ts) native promise in a scenario where you run a computation-intensive task and periodically yield from it to unblock the main thread.

Those concerns aside though, native Promise API is actually quite elegant, and LazyPromise API does not just resemble it, but follows all its subtleties unless stated otherwise in the docs. This has a side benefit of making the library easy to learn.

### One more thing

Unlike both Observable and Promise, LazyPromise supports typed errors. This feature may seem like an afterthought, but curiously, it is in fact required to make the `any` operator ergonomic, as explained below.

## Usage

You create a LazyPromise like you create a native Promise, except you have a `sink` object instead of `resolve, reject` pair, and you can optionally return a teardown function:

```ts
const lazyPromise = new LazyPromise<"value">((sink) => {
  const timeoutId = setTimeout(() => {
    if (...) {
      sink.resolve("value");
    } else {
      sink.reject("error");
    }
  }, 1000);

  return () => {
    clearTimeout(timeoutId);
  };
});
```

Whereas a native Promise executes eagerly and retains the result once it settles, a LazyPromise behaves like an Observable. The way to think of it is `new LazyPromise(foo)` is simply `foo` with a wrapper around it that's only there to enforce a few invariants:

- Nothing gets emitted after you unsubscribe.

- If something does get emitted, that only happens once.

- The teardown function is run at most once, and only if nothing was emitted.

- There can be no higher-order LazyPromise (a LazyPromise that resolves to a LazyPromise). If you call the `resolve` handle of a native `Promise` with a `Promise<string>` as an argument, you'll end up with `Promise<string>`, not `Promise<Promise<string>>`. LazyPromise is similarly flattened.

Just like a function doesn't do anything until you call it, a LazyPromise doesn't do anything until you subscribe to it:

```ts
const subscription = lazyPromise.subscribe({
  resolve: (value) => ...,
  reject: (error) => ...,
});
```

To cancel the subscription, you call

```ts
// This method is idempotent.
subscription.dispose();
```

Aside from superficial differences, LazyPromise API mirrors that of native Promise:

| Promise api                       | LazyPromise equivalent            |
| :-------------------------------- | :-------------------------------- |
| `promise.then(foo)`               | `lazyPromise.map(foo)`            |
| `promise.catch(foo)`              | `lazyPromise.catchRejection(foo)` |
| `promise.finally(foo)`            | `lazyPromise.finalize(foo)`       |
| `Promise.resolve(valueOrPromise)` | `box(valueOrLazyPromise)`         |
| `Promise.reject(error)`           | `rejecting(error)`                |
| `new Promise<never>(() => {})`    | `never`                           |
| `Promise.all(...)`                | `all(...)`                        |
| `Promise.any(...)`                | `any(...)`                        |
| `Promise.race(...)`               | `race(...)`                       |
| `Awaited<T>`                      | `Unbox<T>`                        |

As with an Observable, cancelling a LazyPromise automatically cancels any upstream LazyPromise it was derived from via the operators above.

There is a function `fromEager` that converts an async function to a LazyPromise, and a method `toEager` that converts a LazyPromise to a Promise. Both support AbortSignal API.

There is also a method `pipe` that allows you to dot-chain custom operators: `lazyPromise.pipe(foo)` is equivalent to `foo(lazyPromise)`.

## Typed errors

The way that LazyPromise supports typed errors reflects the JavaScript reality that you cannot typecheck errors that you throw and have to represent typed errors with return values. Instead of having an extra channel in addition to `resolve` and `reject`, we pass typed errors through the `resolve` channel, wrapping them in ErrorBox class to differentiate them from other values. `new ErrorBox(error)` simply stores `error` in its `.error` property. Although `LazyPromise<"value" | ErrorBox<"error">>` is a little bit harder to read than `LazyPromise<"value", "error">`, an extra channel and type parameter would have introduced unnecessary complexity when it comes to using LazyPromise together with native promises and generator syntax.

ErrorBox instances are treated differently from other values by LazyPromise API:

- By default, if you call `.subscribe` or `.toEager` on a LazyPromise that can resolve to boxed errors, you'll get a typechecking error. This makes sure that if for example you add a new error to a server endpoint, you'll catch all the places on the client where that error isn't handled. Both methods have an optional generic type parameter WhitelistedError that you can use to silence the check for some or all errors.

- `map`, `all`, and `race` operators pass boxed errors through the same way they pass through rejections.

There is an operator `catchBoxedError` which is a boxed error counterpart of `catchRejection`, and a helper type `UnboxError` that extracts what's inside an ErrorBox.

It's sometimes convenient to use LazyPromise on the client while sticking to async-await on the server. In that case you can still have server endpoints emit typed errors by returning error boxes from async functions.

Typed errors are optional in the sense that you can pretend that the concept does not exist as long as you don't use the `ErrorBox` class. There's one exception to this which is the `any` operator, but this is only because that operator isn't ergonomic without typed errors anyway. When one of the promises passed to the native `Promise.any` rejects because of a bug, the bug passes undetected if some other input promise resolves. The LazyPromise version of `any` works like `Promise.any` with respect to boxed errors, but rejects if just one input rejects.

## Utilities

The library provides wrappers for browser and Node deferral APIs: `inTimeout`, `inMicrotask`, `inAnimationFrame`, `inIdleCallback`, `inImmediate`, `inNextTick`, `inMessageChannel`, `inScheduled`. Each of these returns a LazyPromise that fires, typically with a value of `undefined`, in respectively `setTimeout`, `queueMicrotask` etc. Since these are non-imaginative convenience wrappers for native APIs, they don't add much complexity to the API surface, yet they remove the need for some extra constructs you'd normally find in libraries that deal with async. Take the use-case of delaying a LazyPromise. With native promises, you could write

```ts
try {
  return originalPromise;
} finally {
  await anotherPromise;
}
```

and this would wait for `anotherPromise` before passing on the result of `originalPromise`. You can delay a LazyPromise in the same way:

```ts
originalLazyPromise.finalize(() => anotherLazyPromise);
```

If `anotherLazyPromise` is `inTimeout(ms)`, that would delay `originalLazyPromise` by `ms`. If `anotherLazyPromise` is `inMicrotask()`, that would make `originalLazyPromise` fire in a microtask.

The library also provides a `log` function that wraps a LazyPromise without changing its behavior, and console.logs everything that happens to it: `lazyPromise.pipe(log("your label"))`.

## Generator syntax

This is a full LazyPromise equivalent of async-await. Just use generator functions instead of async functions, and `yield*` instead of `await`:

```ts
// Type inferred as LazyPromise<"b">
const lazyPromise = fromGen(function* () {
  // Type inferred as "a"
  const value = yield* new LazyPromise<"a">(...);
  // Sleep for 1s.
  yield* inTimeout(1000);
  try {
    yield* someRejectingLazyPromise;
  } catch (error) {
    // Handle rejection.
  }
  return "b" as const;
});
```

Whereas rejections are handled similarly to async-await syntax, boxed errors are in this case treated like any other values that a LazyPromise can resolve to.

Similarly to the `finalize` operator, a `finally` block does not execute if the LazyPromise returned by `fromGen` is unsubscribed before reaching it. If you don't `yield*` inside `try`/`catch`, you keep the guarantee that `finally` will run no matter what.

One last thing to keep in mind is that instead of writing `yield* fromGen(foo)`, you can equivalently yield to the generator function `foo` directly: `yield* foo()`. This has an added advantage of being able to pass arguments. When defining `foo`, you can use a helper type `LazyPromiseGenerator<T>` for return value.

## Class-based API

To get the best performance, for instance when working on a library, you can avoid the overhead of creating and garbage-collecting functions by using objects in their place. Instead of passing a callback to the `LazyPromise` constructor, you can pass an object with `.produce` method (a `Producer`), and instead of returning a teardown function, you can return an object with `.dispose` method (a "job" `Disposable`).
