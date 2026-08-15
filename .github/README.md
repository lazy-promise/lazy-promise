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

Observable is beautifully simple conceptually, and has a great cancellation mechanism. LazyPromise takes care to keep that, but limits Observable to a single shot—you could say it's a JavaScript cousin of a Single in Rx Java. A single-shot Observable [nicely complements Signals](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals) and is not prone to the [Diamond Problem](https://stackblitz.com/edit/rxjs-diamond-problem-s8cy9zzb?devToolsHeight=50&file=index.ts) and [undesirable behavior in the case of synchronous reentry](https://stackblitz.com/edit/rxjs-sync-reentry-vxjr9fhr?devToolsHeight=50&file=index.ts).

### If you start with the native promise

At first glance the native promise seems to obviate the need for a single-shot Observable, but there's a catch—two of them actually, one major and one minor.

First of all, good luck using AbortController API for cancellation. It's not the specifics of that API though that lie at the heart of the problem here, but just the fact that Promise is eager.

Second, like Observable, LazyPromise takes the view that microtasks should not be mandatory. A native promise would guarantee that when you do `promise.then(foo); bar();`, `foo` will run after `bar`, but this "Zalgo" guarantee comes with a cost: if for example you have two async functions that each await a few resolved promises, which of them will finish last will depend on which one has more `await`s in it.

These concerns aside though, the native promise API is actually quite elegant, and LazyPromise API does not just resemble it, but follows all its subtleties unless stated otherwise in the docs. This has a side benefit of making the library way easier to document and learn.

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

A LazyPromise doesn't do anything until you subscribe to it:

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

Whereas a native promise executes eagerly and once, a LazyPromise behaves like an Observable, that is it runs the constructor callback each time someone subscribes. The way to think of it is `new LazyPromise(foo)` is simply `foo` with a wrapper around it that's only there to enforce a few invariants:

- If something gets emitted, that only happens once.

- Nothing gets emitted after you unsubscribe.

- The teardown function is run at most once, and only if nothing was emitted.

- There can be no higher-order LazyPromise (a LazyPromise that resolves to a LazyPromise). If you call the `resolve` handle of a native `Promise` with a `Promise<string>` as an argument, you'll end up with `Promise<string>`, not `Promise<Promise<string>>`. LazyPromise is similarly flattened.

Aside from superficial differences, LazyPromise API mirrors that of native promise:

| Promise API                       | LazyPromise equivalent     |
| :-------------------------------- | :------------------------- |
| `promise.then(foo)`               | `lazyPromise.map(foo)`     |
| `promise.catch(foo)`              | `lazyPromise.catch(foo)`   |
| `promise.finally(foo)`            | `lazyPromise.finally(foo)` |
| `Promise.resolve(valueOrPromise)` | `box(valueOrLazyPromise)`  |
| `Promise.reject(error)`           | `rejecting(error)`         |
| `new Promise<never>(() => {})`    | `never`                    |
| `Promise.all(...)`                | `all(...)`                 |
| `Promise.any(...)`                | `any(...)`                 |
| `Promise.race(...)`               | `race(...)`                |
| `Awaited<T>`                      | `Unbox<T>`                 |

Cancelling a LazyPromise automatically cancels any upstream LazyPromise it was derived from via the operators above.

There is a function `fromEager` that converts an async function to a LazyPromise, and a method `toEager` that converts a LazyPromise to a Promise. Both support AbortController API.

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

If you `yield*` to a lazy promise inside a `try` or `catch` block, and the whole flow is cancelled while waiting for that lazy promise, the `finally` block will not get executed. Similarly, the `.finally` method will run its callback if the lazy promise resolves or rejects, but not if it's unsubscribed before settling.

## Typed errors

The way that LazyPromise supports typed errors reflects the JavaScript reality that you cannot typecheck errors that you throw and have to represent typed errors with return values. Instead of having an extra channel in addition to `resolve` and `reject`, we pass typed errors through the `resolve` channel, wrapping them in ErrorBox class to differentiate them from other values. `new ErrorBox(error)` simply stores `error` in its `.error` property.

There is an operator `catchBoxed` which is a boxed error counterpart of `catch`, and a helper type `UnboxError` that extracts what's inside an ErrorBox.

ErrorBox instances are treated differently from other values by some of the previously mentioned APIs:

- By default, if you call `.subscribe` or `.toEager` on a LazyPromise that can resolve to boxed errors, you'll get a typechecking error. This makes sure that if for example you add a new error to a server endpoint, you'll catch all the places on the client where that error isn't handled. Both methods have an optional generic type parameter WhitelistedError that you can use to silence the check for some or all errors.

- `map`, `all`, and `race` operators pass boxed errors through the same way they pass through rejections, e.g.

  ```
  declare const promiseA: LazyPromise<number | ErrorBox<"oops">>;

  // Type inferred as LazyPromise<string | ErrorBox<"oops">>
  const promiseB = promiseA.map(
    (
      // Type inferred as number
      value,
    ) => String(value),
  );
  ```

- We talked about how when `lazyPromise` rejects with `error`, `yield* lazyPromise` acts exactly like `throw error`. If `lazyPromise` resolves with an ErrorBox instance `boxedError`, `yield* lazyPromise` acts exactly like `return boxedError`. In both cases the execution of the generator function is interrupted, the only difference is that you can't `catch` a boxed error: you have to use `catchBoxed` operator instead. If the execution continues, we know that `lazyPromise` has resolved with something other than a boxed error:

  ```
  declare const promiseA: LazyPromise<number | ErrorBox<"oops">>;

  // Type inferred as LazyPromise<string | ErrorBox<"oops">>
  const promiseB = fromGen(function* () {
    // Type inferred as number
    const value = yield* promiseA;
    return String(value);
  });
  ```

It's sometimes convenient to use LazyPromise on the client and async-await on the server. In that case you can still have the server endpoints produce typed errors by returning error boxes from async functions.

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

The `dep` parameter is made available not only to the LazyPromise constructor callback, but also to all other lazily executed callbacks, namely those you pass to `map`, `catch`, `catchBoxed`, `finally` and `fromGen`, e.g. `lazyPromise.map((value, dep: MyDep) => ...)`. You must specify the type of `dep` explicitly.

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

There is also a helper type `InferDep` which is like `Unbox`, but for the dependency type parameter.

Like typed errors, dependency injection is an optional feature. You can omit the second type parameter of a LazyPromise, in which case it will default to `unknown`, indicating that there are no dependencies.

## Utilities

The library provides wrappers for browser and Node deferral APIs: `inTimeout`, `inMicrotask`, `inAnimationFrame`, `inIdleCallback`, `inImmediate`, `inNextTick`, `inMessageChannel`, `inScheduled`. Each of these returns a LazyPromise that fires, typically with a value of `undefined`, in respectively `setTimeout`, `queueMicrotask` etc. Since these are non-imaginative convenience wrappers for native APIs, they don't add much complexity to the API surface, yet they remove the need for some extra constructs you'd normally find in libraries that deal with async. For example, to sleep for 1 second in the middle of a generator function, you would `yield* inTimeout(1000)`.

The library also provides a `log` function that wraps a LazyPromise without changing its behavior, and `console.log`s everything that happens to it: `lazyPromise.pipe(log("your label"))`.

## Class-based API

To get the best performance, for instance when working on a library, you can avoid the overhead of creating and garbage-collecting functions by using objects in their place. Instead of passing a callback to the `LazyPromise` constructor, you can pass an object with `.produce` method (a `Producer`), and instead of returning a teardown function, you can return an object with `.dispose` method (a `Job`).

## Q&A

<details>
<summary><strong>Why is the method <code>map</code> called <code>map</code>?</strong></summary>

It cannot be `then` since JavaScript has some built-in behaviors around that particular name, and as to `map` vs. `flatMap`, we're taking advantage here of the fact that there can be no higher-order lazy promises. If `map` gets a LazyPromise from its callback, it cannot return a `LazyPromise<LazyPromise<...>>` and has no choice but to flatten the result, so we don't need to disambiguate between `map` and `flatMap`. Similarly, we can just say `box` since we don't have to disambiguate between `box` and `normalize`.

</details>

<details>
<summary><strong>Why no symmetry as in <code>Promise.resolve</code> and <code>Promise.reject</code>?</strong></summary>

Because actually there is no symmetry in the case of native promises either. If you give `Promise.resolve` a Promise, it will flatten it. If you give `Promise.reject` a Promise, it will just immediately throw it.

</details>

<details>
<summary><strong>Why dot notation and not pipes-only like RxJS?</strong></summary>

Because unlike RxJS, there exists a small and well-defined set of operators that can be mentally put into the same category as language features, and that are more equal than others.

</details>

<details>
<summary><strong>Why does <code>finally</code> not run when the lazy promise is cancelled?</strong></summary>

This question applies to both the `finally` block in generator functions and the `.finally` method. There are three reasons:

- That's how generator functions work in JavaScript: you only get the guarantee that the `finally` block gets executed if you don't `yield` in `try`/`catch`.

- Using `finally` for cleanup would go against only-one-way-to-do-it since there is already teardown logic that you return from LazyPromise constructor.

- This enables the pattern `lazyPromise.finally(() => anotherLazyPromise)`, which is the equivalent of the native

  ```
  try {
    return await promise;
  } finally {
    // Wait for `anotherPromise`, then pass on result of `promise`.
    await anotherPromise;
  }
  ```

  and which can for example be used to make a lazy promise fire in a microtask like a native promise: `lazyPromise.finally(inMicrotask)`.

</details>

<details>
<summary><strong>Why doesn't LazyPromise provide an affordance for sharing/caching the result?</strong></summary>

While this is achievable with userland operators like those in RxJS, it's not something you want to bake into the primitive, because how you do it depends on what you use for state. If it's Signals, there is an existing `computed`/`createMemo` that just needs to be [extended so it knows what to do with lazy promises](https://github.com/lazy-promise/lazy-promise/tree/main/packages/alien-signals#step-2-memos).

</details>

<details>
<summary><strong>Why not a separate channel for typed errors?</strong></summary>

Although `LazyPromise<"value" | ErrorBox<"error">>` is a little bit harder to read than `LazyPromise<"value", "error">`, an extra channel and type parameter would have introduced unnecessary complexity when it comes to using LazyPromise together with native promises and generator syntax. You wouldn't be able to produce typed errors in native async functions by returning ErrorBoxes, and try/catch/finally syntax in generator functions would have non-obvious behavior.

</details>
