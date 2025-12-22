# Experimental SolidJS bindings for LazyPromise

[Introductory article](https://dev.to/ivan7237d/cancelable-async-tasks-and-typed-server-errors-with-solidjs-and-lazypromise-1la)

For details on LazyPromise, please see [root readme](https://github.com/lazy-promise/lazy-promise).

## Installation

```bash
npm install @lazy-promise/core @lazy-promise/solid-js pipe-function
```

## Usage

### useLazyPromise

Simply subscribes to a lazy promise and unsubscribes when the scope is disposed.

```
useLazyPromise(yourLazyPromise);
```

Since this function takes a lazy promise with error type `never`, type system will catch any unhandled rejections. All callbacks are run outside the scope and so are untracked:

```
useLazyPromise(
  pipe(
    yourLazyPromise,
    map(value => {
      // Reading a signal here will not create a dependency even
      // when the callback is run synchronously.
    })
  )
)
```

To error out the scope, fail the lazy promise:

```
useLazyPromise(
  pipe(
    yourLazyPromise,
    catchRejection(error => {
      // Trigger the error boundary.
      throw error;
    })
  )
)
```

### createFetcher

Creates a fetcher that you can pass to `createResource`.

```
const [accessor] = createResource(createFetcher(() => yourLazyPromise));
```

The fetcher will subscribe/unsubscribe to the lazy promise as needed. As with `useLazyPromise`, the lazy promise is required to have error type `never`, the callbacks are untracked, and failing the lazy promise will error out the scope. If you pass the fetcher as the second argument of `createResource`, you'll need to help TypeScript along (but since this is not a type assertion, this will not affect correctness):

```
const [accessor] = createResource(
  count,
  // Notice `count: number`.
  createFetcher((count: number) => yourLazyPromise)
);
```

### createTrackProcessing

This is a little like Suspense for mutations: a typical use-case is to disable a button (and maybe show a spinner) when the user clicks it and some async action is performed.

```
const [processing, trackProcessing] = createTrackProcessing();
```

Here, `trackProcessing` (a value of type `TrackProcessing`) is an operator that you can use to wrap one or more lazy promises:

```
const wrappedLazyPromise = pipe(lazyPromise, trackProcessing);
```

`processing` is an accessor that will tell you whether any of the wrapped promises are currently active (subscribed but not yet settled/unsubscribed):

```
<button
  onClick={() => {
    useLazyPromise(wrappedLazyPromise);
  }}
  disabled={processing()}
>
  Click Me
</button>
```

## ESLint

If you use `eslint-plugin-solid`, add the `pipe` function to `customReactiveFunctions` in ESLint config (it's not a reactive function but `eslint-plugin-solid` doesn't know to correctly interpret what this function does):

```
"solid/reactivity": [
  "warn",
  {
    customReactiveFunctions: ["pipe"],
  },
],
```
