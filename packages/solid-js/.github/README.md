# Experimental glue for LazyPromise and Solid 2

For details on LazyPromise, please see the [root readme](https://github.com/lazy-promise/lazy-promise).

## Installation

```bash
npm install @lazy-promise/core @lazy-promise/solid-js
```

## `cg` and `eg`

This stands for "computation glue" and "effect glue". Whenever Solid API expects an async iterable, you can return `yourLazyPromise.pipe(cg)`, for example

```ts
const [count, setCount] = createSignal(0);
const debouncedCount = createMemo(() =>
  // Track `count` and wrap it in a LazyPromise
  box(count())
    // Delay that LazyPromise by a second
    .finalize(() => inTimeout(1000))
    // Computation glue
    .pipe(cg),
);
```

`eg` is used with `createEffect`/`createRenderEffect` as the second argument: `createEffect(() => yourLazyPromise, eg)`. For example,

```ts
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
  });
}, eg);
```

In both cases there is a clear distinction on what is and isn't tracked: you _build_ a LazyPromise in a tracked context, and it gets _subscribed_ in untracked (and ownerless) context.

Both utilities will give you a typechecking error if you fail to catch any [boxed errors](https://github.com/lazy-promise/lazy-promise#typed-errors).

## OwnerDep

`cg` and `eg` [dependency-inject](https://github.com/lazy-promise/lazy-promise#dependency-injection) an object of the shape

```ts
interface OwnerDep {
  [typeof ownerSymbol]: Owner | null;
}
```

That means that anywhere in your async logic you can get hold of the owner without having to explicitly pass it around:

```ts
const yourLazyPromise = fromGen(function* (dep: OwnerDep) {
  const result = runWithOwner(dep[ownerSymbol], () => {
    // Call `onCleanup` or `useContext`.
  });
});
```

There is a `runWithOwnerDep` utility that makes this a little more concise:

```ts
const yourLazyPromise = fromGen(function* () {
  const result = yield* runWithOwnerDep(() => {
    // Call `onCleanup` or `useContext`.
  });
});
```
