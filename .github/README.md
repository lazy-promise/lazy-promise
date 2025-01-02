# LazyPromise

A LazyPromise is just like a regular promise, but is lazy and cancelable, supports typed errors, and resolves/rejects synchronously instead of in a microtask.

## Installation

```bash
npm install @lazy-promise/core pipe-function
```

In the above snippet, [`pipe-function` package](https://github.com/ivan7237d/pipe-function) provides the `pipe` function (`pipe(x, foo, bar)` is `bar(foo(x))`) - you can use one from another library if you like.

## Usage

You subscribe to a LazyPromise by calling `.subscribe` on it, which returns an idempotent `() => void` function that you can call to unsubscribe:

```
// Subscribe
const unsubscribe = lazyPromise.subscribe((value) => ..., (error) => ...);

// Unsubscribe
unsubscribe();
```

| `Promise` api                  | `LazyPromise` equivalent                     |
| :----------------------------- | :------------------------------------------- |
| `new Promise<Value>(...)`      | `createLazyPromise<Value, Error>(...)`       |
| `promise.then(foo)`            | `pipe(lazyPromise, map(foo))`                |
| `promise.catch(foo)`           | `pipe(lazyPromise, catchError(foo))`         |
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

The callback that you give to `createLazyPromise` is run whenever the subscriber count becomes positive. It has a signature that's similar to regular promise (`(resolve, reject) => ...`), except it can return a teardown function (aka "dispose" function or disposable) that we'll call if the subscriber count goes back to 0 before the promise resolves or rejects.

When you subscribe to a LazyPromise whose error type is other than `never`, you must provide an error handler or you'll get a type error. This way you can make sure that all errors are handled.

Since errors are typed, you should not intentionally throw in callbacks. If a callback does throw an error, it's automatically a bug. Instead of rejecting the promise, we just asynchronously re-throw the error so it could get picked up by the browser console or an error tracker.

You can interop with regular promises using functions `lazy` and `eager`.
