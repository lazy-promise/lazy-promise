# LazyPromise

A LazyPromise is like a native promise, except

- It's lazy and cancelable

- It emits synchronously instead of in a microtask

- It supports typed errors and dependency injection.

## Installation

```bash
npm install @lazy-promise/core
```

## Motivation

### If you start with Observable

Observable is beautifully simple conceptually, and has a great cancellation mechanism. LazyPromise takes care to keep that, but limits Observable to a single shot—you could say it's a JavaScript cousin of a Single in Rx Java.

The formal argument for the single-shot restriction is that there is nothing stopping a developer from using a multi-shot Observable to represent derived state, and running into the [Diamond Problem](https://stackblitz.com/edit/rxjs-diamond-problem-s8cy9zzb?devToolsHeight=50&file=index.ts) and [undesirable behavior in the case of sync reentry](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=50&file=index.ts).

The informal argument is that Signals have filled in one piece of the puzzle—a push-pull primitive that solves derived state—and now we need another piece that complements the first one and focuses just on waiting for a state to resolve, not on changes in an already resolved state. [This proof-of-concept Async Signals library](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals) shows how these two pieces can be put together.

### If you start with the native promise

What's been said above sounds like all the more reason to use the native promise, but there's a catch, two of them actually, one major and one minor.

First of all, good luck using AbortSignal API for cancellation. It's not the specifics of that API though that lie at the heart of the problem here, but just the fact that Promise is eager.

Second, like Observable, LazyPromise takes the view that microtasks should not be mandatory. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this "Zalgo" guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more `await`s in it.

Those concerns aside though, native promise API is actually quite elegant, and LazyPromise API does not just resemble it, but follows all its subtleties unless stated otherwise in the docs. This has a side benefit of making the library easy to document and learn.

### If you start with Effect

Like Effect, LazyPromise supports generator syntax, typed errors, and dependency injection, but the two could not be further apart on the library vs. framework scale.

## Usage

You create a LazyPromise like you create a native promise, except you have a `sink` object instead of `resolve, reject` pair, and you can optionally return a teardown function:

```
const lazyPromise = new LazyPromise<number>((sink) => {
  const timeoutId = setTimeout(() => {
    if (...) {
      sink.resolve(42);
    } else {
      sink.reject(new Error("oops"));
    }
  }, 1000);

  return () => {
    clearTimeout(timeoutId);
  };
});
```

Whereas a native promise executes eagerly and retains the result once it settles, a LazyPromise behaves like an Observable. The way to think of it is `new LazyPromise(foo)` is simply `foo` with a wrapper around it that's only there to enforce a few invariants:

- If something gets emitted, that only happens once.

- Nothing gets emitted after you unsubscribe.

- The teardown function is run at most once, and only if nothing was emitted.

- There can be no higher-order LazyPromise (a LazyPromise that resolves to a LazyPromise). If you call the `resolve` handle of a native `Promise` with a `Promise<string>` as an argument, you'll end up with `Promise<string>`, not `Promise<Promise<string>>`. LazyPromise is similarly flattened.

Just like a function doesn't do anything until you call it, a LazyPromise doesn't do anything until you subscribe to it:

```
const subscription = lazyPromise.subscribe({
  resolve: (value) => ...,
  reject: (error) => ...,
});
```

To cancel the subscription, you call

```
// This method is idempotent.
subscription.dispose();
```

Aside from superficial differences, LazyPromise API mirrors that of native promise:

| Promise API                       | LazyPromise equivalent            |
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

Cancelling a LazyPromise automatically cancels any upstream LazyPromise it was derived from via the operators above.

There is a function `fromEager` that converts an async function to a LazyPromise, and a method `toEager` that converts a LazyPromise to a Promise. Both support AbortSignal API.

There is also a method `pipe` that allows you to dot-chain custom operators: `lazyPromise.pipe(foo)` is equivalent to `foo(lazyPromise)`.

## Generator syntax

This syntax is the LazyPromise equivalent of async-await. It lets you take advantage of JavaScript control flow statements, and as with chained operators, you get automatic cancellation. Just use generator functions instead of async functions, and `yield*` instead of `await`:

```
// Type inferred as LazyPromise<number>
const lazyPromise = fromGen(function* () {
  while (true) {
    // Type inferred as number | undefined
    const value = yield* new LazyPromise<number | undefined>(...);
    if (value !== undefined) {
      return value;
    }
  }
});
```

In the case of native promises, if you `await promise`, and `promise` rejects with `error`, it's as if in place of `await promise` you had `throw error`. It works in exactly the same way when you have `yield* lazyPromise` and `lazyPromise` rejects.

## Utilities

The library provides wrappers for browser and Node deferral APIs: `inTimeout`, `inMicrotask`, `inAnimationFrame`, `inIdleCallback`, `inImmediate`, `inNextTick`, `inMessageChannel`, `inScheduled`. Each of these returns a LazyPromise that fires, typically with a value of `undefined`, in respectively `setTimeout`, `queueMicrotask` etc. Since these are non-imaginative convenience wrappers for native APIs, they don't add much complexity to the API surface, yet they remove the need for some extra constructs you'd normally find in libraries that deal with async. Take the use-case of delaying a LazyPromise result. With native promises, you could write

```
try {
  return await originalPromise;
} finally {
  await anotherPromise;
}
```

and this would wait for `anotherPromise` before passing on the result of `originalPromise`. You can delay a LazyPromise in the same way:

```
try {
  return yield* originalLazyPromise;
} finally {
  yield* anotherLazyPromise;
}
```

or

```
originalLazyPromise.finalize(() => anotherLazyPromise);
```

If `anotherLazyPromise` is `inTimeout(ms)`, that would delay `originalLazyPromise` by `ms`. If `anotherLazyPromise` is `inMicrotask()`, that would make `originalLazyPromise` fire in a microtask.

Notice that whether it's a `finally` block or the `finalize` operator, `anotherLazyPromise` will never get subscribed if the whole flow is cancelled while waiting for originalLazyPromise. In the sync world, we're used to a guarantee that the `finally` block always runs, and you do get that guarantee, but only if you don't `yield*` inside `try`/`catch`—it's simply the way JavaScript generator functions work.

The library also provides a `log` function that wraps a LazyPromise without changing its behavior, and console.logs everything that happens to it: `lazyPromise.pipe(log("your label"))`.

## Typed errors

The way that LazyPromise supports typed errors reflects the JavaScript reality that you cannot typecheck errors that you throw and have to represent typed errors with return values. Instead of having an extra channel in addition to `resolve` and `reject`, we pass typed errors through the `resolve` channel, wrapping them in ErrorBox class to differentiate them from other values. `new ErrorBox(error)` simply stores `error` in its `.error` property. Although `LazyPromise<"value" | ErrorBox<"error">>` is a little bit harder to read than `LazyPromise<"value", "error">`, an extra channel and type parameter would have introduced unnecessary complexity when it comes to using LazyPromise together with native promises and generator syntax.

There is an operator `catchBoxedError` which is a boxed error counterpart of `catchRejection`, and a helper type `UnboxError` that extracts what's inside an ErrorBox.

ErrorBox instances are treated differently from other values by some of the previously mentioned APIs:

- By default, if you call `.subscribe` or `.toEager` on a LazyPromise that can resolve to boxed errors, you'll get a typechecking error. This makes sure that if for example you add a new error to a server endpoint, you'll catch all the places on the client where that error isn't handled. Both methods have an optional generic type parameter WhitelistedError that you can use to silence the check for some or all errors.

- `map`, `all`, and `race` operators pass boxed errors through the same way they pass through rejections.

- We talked about how when `lazyPromise` rejects with `error`, `yield* lazyPromise` acts exactly like `throw error`. If `lazyPromise` resolves with an ErrorBox instance `boxedError`, `yield* lazyPromise` acts exactly like `return boxedError`. In both cases the execution of the generator function is interrupted, the only difference being that you can't `catch` a boxed error: you have to use `catchBoxedError` operator instead.

It's sometimes convenient to use LazyPromise on the client while sticking to async-await on the server. In that case you can still have typed errors by having async functions on the server return error boxes.

Typed errors are optional in the sense that you can pretend that the concept does not exist as long as you don't use the `ErrorBox` class. There's one exception to this which is the `any` operator, but this is only because that operator isn't very ergonomic without typed errors anyway. When one of the promises passed to the native `Promise.any` rejects because of a bug, the bug passes undetected if some other input promise resolves. The LazyPromise version of `any` works like `Promise.any` with respect to boxed errors, but rejects if just one input rejects.

## Dependency injection

We've talked about how `new LazyPromise(foo)` is really just a wrapper around `foo`. Dependency injection is about being less restrictive about what kind of functions LazyPromise can wrap: namely, in addition to the first parameter of the shape `{ resolve, reject }`, we also allow a second parameter called "dependency" that can be of any type:

```
const lazyPromise = new LazyPromise<MyValue, MyDep>(
  (
    sink,
    dep, // Type is `MyDep`.
  ) => ...,
);

lazyPromise.subscribe(
  consumer,
  dep, // Must satisfy `MyDep`.
);
```

Dependencies bubble up through the type system when you use the operators or the generator syntax, so for example if `promiseA` has dependency `A` and `promiseB` has dependency `B`, `all([promiseA, promiseB])` will have dependency `A & B`, in other words `all` needs a dependency that it'll be able to pass to both `promiseA` and `promiseB`. This is useful for testing since you can gather up a bunch of dependencies needed by your async logic, and then satisfy them with either production implementations or mocks.

The `dep` parameter is made available not only to the LazyPromise constructor callback, but also to all other lazily executed callbacks, namely those you pass to `map`, `catchRejection`, `catchBoxedError`, `finalize` and `fromGen`, e.g. `lazyPromise.map((value, dep: MyDep) => ...)`. You must specify the type of `dep` explicitly.

You can satisfy the dependency when subscribing, but you can also do it sooner using `inject` method of a LazyPromise. That method's callback should return a dependency, but like other lazy callbacks, it can optionally take a dependency as a parameter, allowing dependencies to depend on one another:

```
declare const upstreamLazyPromise: LazyPromise<MyValue, UpstreamDep>;

// Type inferred as LazyPromise<MyValue, DownstreamDep>.
const downstreamLazyPromise = upstreamLazyPromise.inject(
  (dep: DownstreamDep) => <a value that satisfies UpstreamDep>,
);
```

It's often convenient, especially when using a dependency across multiple modules, to define it as an object with symbol keys, since you can satisfy multiple such dependencies with a single object without worrying about name clashes:

```
export const randomSymbol = Symbol("random");
export interface RandomDep {
  [randomSymbol]: () => number;
}
```

There is also a helper type `InferDep` which is like `Unbox`, but for the second type parameter `Dep` of a LazyPromise.

Like typed errors, dependency injection is an optional feature. By default, the second type parameter `Dep` of a LazyPromise is `unknown`, indicating it does not have dependencies.

## Class-based API

To get the best performance, for instance when working on a library, you can avoid the overhead of creating and garbage-collecting functions by using objects in their place. Instead of passing a callback to the `LazyPromise` constructor, you can pass an object with `.produce` method (a `Producer`), and instead of returning a teardown function, you can return an object with `.dispose` method (a "job" `Disposable`).
