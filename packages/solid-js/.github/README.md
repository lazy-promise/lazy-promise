# Glue for LazyPromise and Solid 2.0

For details on LazyPromise, please see the [root readme](https://github.com/lazy-promise/lazy-promise).

## Installation

```bash
npm install @lazy-promise/core @lazy-promise/solid-js
```

## `glue` and `noop`

Whenever Solid API expects an async iterable, you can pass `yourLazyPromise.pipe(glue)`, for example

```
const [count, setCount] = createSignal(0);
const debouncedCount = createMemo(() =>
  // Track `count` and wrap it in a LazyPromise
  box(count())
    // Delay that LazyPromise by a second
    .finally(() => inTimeout(1000))
    // Add glue
    .pipe(glue),
);
```

With `createEffect`/`createRenderEffect`, the effect logic can live entirely in the LazyPromise, and you can pass `noop` (simply `() => {}`) as the required second argument: `createEffect(() => yourLazyPromise.pipe(glue), noop)`. For example,

```
createEffect(() => {
  const someValue = someTrackedAccessor();
  // For a change, create a LazyPromise using generator syntax
  return fromGen(function* () {
    while (true) {
      // Type of `pollResult` is inferred similarly to async/await syntax
      const pollResult = yield* pollYourEndpoint(someValue);
      if (pollResult !== undefined) {
        // Do something using pollResult

        return;
      }
      // Sleep before next iteration.
      yield* inTimeout(1000);
    }
  }).pipe(glue);
}, noop);
```

In both cases there is a clear distinction on what is and isn't tracked: you _build_ a LazyPromise in a tracked context, and it gets _subscribed_ in untracked (and ownerless) context. The LazyPromise is unsubscribed when Solid closes the async iterable (when the computation re-runs or is disposed), and rejections are handled by Solid the same way as rejections of a native promise returned from a computation.

`glue` will give you a typechecking error if you fail to catch any [boxed errors](https://github.com/lazy-promise/lazy-promise#typed-errors).

## OwnerDep

`glue` [dependency-injects](https://github.com/lazy-promise/lazy-promise#dependency-injection) an object of the shape

```
interface OwnerDep {
  [ownerSymbol]: Owner | null;
}
```

That means that anywhere in your async logic you can get hold of the owner without having to explicitly pass it around:

```
const yourLazyPromise = fromGen(function* (dep: OwnerDep) {
  const result = runWithOwner(dep[ownerSymbol], () => {
    // Call `useContext`.
  });
});
```

There is a `runWithOwnerDep` utility that makes this a little more concise:

```
const yourLazyPromise = fromGen(function* () {
  const result = yield* runWithOwnerDep(() => {
    // Call `useContext`.
  });
});
```

## Playground

[Basic](https://stackblitz.com/edit/solid2-glue?file=src%2Fmain.tsx) | [OwnerDep](https://stackblitz.com/edit/solid2-glue-lzpbsrxt?file=src%2Fmain.tsx)
