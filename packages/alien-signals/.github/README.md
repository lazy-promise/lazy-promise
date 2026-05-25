# @lazy-promise/alien-signals

A proof-of-concept async signals library built on top of [alien-signals](https://github.com/stackblitz/alien-signals) and [LazyPromise](https://github.com/lazy-promise/lazy-promise).

## Installation

```bash
npm install @lazy-promise/alien-signals @lazy-promise/core
```

## Introduction

This library shows what async signals could look like if instead of the native promise you use LazyPromise. We'll take alien-signals as the starting point, and then change the API in three steps, surfacing along the way a couple of reasons why the same cannot be implemented using the native Promise.

## Step 1: effects

The LazyPromise equivalent of an async function is a function that returns a LazyPromise. If the `effect()` callback returns a LazyPromise, we'll subscribe to it in untracked context and unsubscribe when the effect is torn down.

Consider the following code snippet:

```ts
const a = signal(0);
const b = signal(0);

effect(() =>
  // Translation: Promise.resolve(a())
  box(a())
    // Translation: .then(a => a + b())
    .map((a) => a + b())
    // Translation: .then(console.log)
    .map(console.log),
);
```

The `effect` callback reads the signal `a`, creating a tracked dependency, but it does not call the `map` callback: all it does is it builds and returns a LazyPromise. The `map` callback will run when `effect` subscribes to that LazyPromise, but since we do that in untracked context, dependency on `b` will not be tracked.

If you did want the effect to re-run when `b` changes, you would do this instead:

```ts
const a = signal(0);
const b = signal(0);

effect(() =>
  all([a(), b()])
    .map(([a, b]) => a + b)
    .map(console.log),
);
```

A footnote: to keep things simple, the above snippets don't involve any actual async, but if for example you add `.finalize(() => inTimeout(1000))` after `all(...)`, this will delay the effect by a second but otherwise won't change the logic.

Another example is LazyPromise constructor:

```ts
effect(() => {
  // ...

  // `subscriber` has methods `resolve` and `reject` and is the
  // equivalent of resolve/reject handles of a Promise.
  return new LazyPromise((subscriber) => {
    // ...
  });
});
```

Here the reads in the effect callback would be tracked, and the reads in the LazyPromise constructor callback won't be, since the latter is executed when the LazyPromise is subscribed.

We wouldn't be able to have the same simple convention on what is and isn't tracked if we used a native Promise, since in

```ts
effect(() => {
  // ...
  return new Promise((resolve, reject) => {
    // ...
  });
});
```

the Promise constructor callback would execute synchronously, so as long as you track the effect callback, you'd also be tracking the Promise constructor callback.

Since LazyPromise supports typed errors, there's one more twist which you can ignore if you're not interested in that functionality: we'll make `effect(...)` show a typechecking error if the LazyPromise returned by the callback can resolve to a TypedError. This makes sure that if, for example, there is a new typed error that a server endpoint can return, you don't forget to handle it in all the relevant places on the client.

## Step 2: memos

Like an Observable and unlike the native Promise, LazyPromise doesn't store and multi-cast its result by default, so if you create

```ts
const lazyPromise = new LazyPromise(foo);
```

`foo` will be called each time you subscribe to `lazyPromise`. Because of this, if a memo aka `computed` callback returns a LazyPromise, instead of just passing it along, we're going to proxy it with another LazyPromise so that:

- The original lazy promise can have at most one subscriber at a time, and the result will be multi-casted among all the subscribers of the proxy promise.

- As long as the memo is in the dependency graph, it should either be subscribed to the original lazy promise and waiting for it to settle, or hold on to the result once the promise does settle.

- As with the effects, we subscribe in untracked context and unsubscribe as needed.

Let's take a look at the following example:

```ts
// Type () => LazyPromise<number>
const remoteCount = computed(
  // Type () => LazyPromise<number>
  fetchRemoteCount,
);

const localCount = signal(0);

effect(() =>
  all([localCount(), remoteCount()]).map(([localCount, remoteCount]) => {
    console.log(localCount + remoteCount);
  }),
);
```

If you increment `localCount` while the `remoteCount` is still loading, `effect` will need to rerun, so it will unsubscribe and then immediately re-subscribe to `remoteCount`. `remoteCount`, however, is the proxy promise, not the original promise returned by `fetchRemoteCount`. Since all the while the memo stays in the dependency graph, that original promise will stay subscribed.

Continuing with this example, once the original promise settles with a value or an error, the memo will hold on to that result for as long as it stays in the dependency graph, and immediately give it to anyone who subscribes to `remoteCount`. This is analogous to how things work with non-async memos.

To prevent redundant reactive updates, when the memo re-runs, we change the identity of the proxy promise only when necessary, specifically when both hold:

- The previous lazy promise has settled.

- The new lazy promise does not synchronously settle to the same value or error that the previous promise has settled to.

The first condition means we're never changing the identity of the proxy if the promise previously returned by the callback hasn't settled yet. In this case we can just as well use the existing proxy promise to pass on the value or error once we have it.

The second condition means that after the callback returns, but before the `computed` itself returns, we subscribe to the new lazy promise and check if it synchronously settles to the same result as the cached result. If so, there is no need for downstream updates. This logic is possible thanks to the fact that unlike native Promise, LazyPromise doesn't defer notifications to microtasks.

## Step 3: batching

As in [Solid 2.0 signals](https://github.com/solidjs/solid/blob/next/documentation/solid-2.0/01-reactivity-batching-effects.md#flush-and-microtask-batching), we're going to add auto-batching, meaning that writing a signal will not actually update it until you run `flush()`, and if you don't run `flush()`, it will be run for you in a microtask.

This makes sense irrespective of async: unless the flush is deferred, each time you update a signal outside of a batch, you're not just saying "update a signal", but "update a signal and I guarantee that I'm not about to update more signals". With async this becomes more of an issue because multiple signals are likely to be written when a lazy promise fires, and you don't want redundant reactive updates.

With this change, there is no longer a need for `startBatch`/`endBatch`.

## PS: what you can build on top

On the client, you can have JSX or templates take lazy promises as inputs and trigger suspense/error boundaries, or you can implement colorless signals Solid 2.0-style. On the server, you can use async signals for async logic that could otherwise be implemented with RxJS or Effect.

As an example, we'll build a function `unbox` that takes a lazy promise getter (`() => LazyPromise<T>`) and returns a signal that gives you the value that the promise resolves to, or `undefined` if the promise hasn't resolved yet. Here's how one could use it:

```ts
const str = signal("");
// Type () => string | undefined
const debounced = unbox(
  // Type () => LazyPromise<string>
  () =>
    box(str())
      // Delays a lazy promise by 0.5s.
      .finalize(() => inTimeout(500)),
);
```

When implementing `unbox`, the trick is not to write (or `trigger`) signals synchronously in `computed` callbacks. If we did that, then even with auto-batching we'd end up with redundant reactive updates. If the promise resolves synchronously, we use only memos, and only trigger a signal if the promise settles asynchronously:

```ts
const unbox = <T>(
  // Errors are expected to have been handled, so do not accept
  // promises that can resolve to typed errors.
  getter: () => Extract<T, TypedError<any>> extends never
    ? LazyPromise<T>
    : never,
): (() => T | undefined) => {
  let returnValue: T | undefined, returnValuePromise: unknown;
  const memoizedGetter = computed(getter);
  // A signal we'll use to trigger downstream updates in the case
  // when the promise resolves asynchronously.
  const tokenSignal = signal();
  return computed(() => {
    const promise = memoizedGetter();
    effect<any>(() =>
      promise.map((value) => {
        returnValue = value;
        if (returnValuePromise === promise) {
          // The promise has resolved asynchronously.
          trigger(tokenSignal);
          return;
        }
        returnValuePromise = promise;
      }),
    );
    if (returnValuePromise === promise) {
      // The promise has resolved synchronously.
      return returnValue;
    }
    returnValuePromise = promise;
    tokenSignal();
  });
};
```

[Playground link](https://stackblitz.com/edit/unbox?devToolsHeight=33&file=index.ts)
