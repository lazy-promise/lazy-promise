# Experimental React bindings for LazyPromise

For details on LazyPromise, please see [root readme](https://github.com/lazy-promise/lazy-promise).

## Installation

```bash
npm install @lazy-promise/core @lazy-promise/react
```

## What This Package Provides

This package focuses on three React integration concerns:

- **Suspense integration**: `useLazyPromise` uses React's Suspense mechanism (throwing a pending thenable) so async work can pause rendering until data is ready.

- **Cancellation by default**: subscriptions are torn down on unmount and when dependencies change.

- **Typed-error safety**: `useLazyPromise`, `useLazyPromiseState`, and `subscribe` all reject LazyPromise inputs that can resolve to a [TypedError](https://github.com/lazy-promise/lazy-promise#typed-errors), meaning that TS will tell you if you forget to handle an error.

### Suspense Rendering Example

```tsx
import { useLazyPromise } from "@lazy-promise/react";
import { Suspense, useMemo } from "react";

function UserProfile({ userId }: { userId: string }) {
  const user = useLazyPromise(
    useMemo(() => fetchUser(userId).map(normalizeUser), [userId]),
  );
  return <div>{user.name}</div>;
}

export default function App() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <UserProfile userId="123" />
    </Suspense>
  );
}
```

### Cancellation Example (`fromEager` + `AbortSignal`)

```tsx
import { fromEager } from "@lazy-promise/core";
import { subscribe } from "@lazy-promise/react";
import { useEffect, useMemo } from "react";

function UserSearch({ query }: { query: string }) {
  // A LazyPromise.
  const task = useMemo(
    () =>
      fromEager(async ({ signal }) => {
        const response = await fetch(`/api/search?q=${query}`, { signal });
        const data = (await response.json()) as { items: string[] };
        return data.items;
      })
        .map((value) => {
          // set state with value
        })
        .catchRejection((error) => {
          // report/log error
        }),
    [query],
  );

  useEffect(() => {
    return subscribe(task);
  }, [task]);

  return null;
}
```

When `query` changes or the component unmounts, the previous subscription is canceled. In this example that cancellation propagates to `AbortSignal` used by `fetch`.

### Typed Error Example (`TypedError` + `catchTypedError`)

```tsx
import { useLazyPromise } from "@lazy-promise/react";
import { useMemo } from "react";

type NotFound = { code: "NOT_FOUND" };
type RateLimited = { code: "RATE_LIMITED" };

function Profile() {
  // Without catchTypedError, all three utilities in this package will show TS errors.
  const user = useLazyPromise(
    useMemo(
      () =>
        fetchUser().catchTypedError((error: NotFound | RateLimited) => {
          if (error.code === "NOT_FOUND") {
            return { name: "Anonymous" };
          }
          return { name: "Try again in a moment" };
        }),
      [],
    ),
  );

  return <div>{user.name}</div>;
}
```

## Hooks

### `useLazyPromise(lazyPromise)`

The primary hook that integrates a LazyPromise into React's Suspense system. The component will suspend while pending and render with the value when resolved.

When you apply operators (`map`, `catchRejection`, etc.), create the chain inside `useMemo` so the LazyPromise reference stays stable across renders.

**Type signature:**

```typescript
function useLazyPromise<T>(lazyPromise: LazyPromise<T>): T;
```

**Example:**

```tsx
import { useLazyPromise } from "@lazy-promise/react";
import { useMemo } from "react";

function UserProfile({ userId }: { userId: string }) {
  const user = useLazyPromise(
    useMemo(() => fetchUser(userId).map(normalizeUser), [userId]),
  );
  return <div>{user.name}</div>;
}
```

Use this component under a `Suspense` boundary, as shown in the earlier Suspense example.

**Key behaviors:**

- Throws a promise to trigger Suspense boundaries
- Throws errors to trigger Error Boundaries
- Automatically unsubscribes on unmount
- If you pass a new LazyPromise reference, it re-subscribes automatically

**Note on TypedError:** This hook rejects inputs that may resolve to `TypedError` (including unions like `Value | TypedError<E>`). Use `.catchTypedError()` to convert typed errors before passing to the hook, and memoize the derived `LazyPromise` if you create it during render:

```tsx
import { useMemo } from "react";

const value = useLazyPromise(
  useMemo(
    () =>
      lazyPromise.catchTypedError((error) => {
        // Handle typed error and return a regular value
        return defaultValue;
      }),
    [lazyPromise],
  ),
);
```

### `useLazyPromiseState(lazyPromise)`

For cases where you need manual control over loading and error states instead of using Suspense.

**Type signature:**

```typescript
function useLazyPromiseState<T>(
  lazyPromise: LazyPromise<T>,
):
  | { status: "pending"; data?: never; error?: never }
  | { status: "success"; data: T; error?: never }
  | { status: "error"; data?: never; error: unknown };
```

**Example:**

```tsx
import { useLazyPromiseState } from "@lazy-promise/react";
import { useMemo } from "react";

function UserProfile({ userId }: { userId: string }) {
  const state = useLazyPromiseState(useMemo(() => fetchUser(userId), [userId]));

  if (state.status === "pending") return <div>Loading...</div>;
  if (state.status === "error") return <div>Error: {String(state.error)}</div>;
  return <div>{state.data.name}</div>;
}
```

**Key behaviors:**

- Does not throw promises or errors
- Returns a discriminated union keyed by `status`
- Rejections go to `{ status: "error", error }`
- Inputs may not resolve to `TypedError`; use `.catchTypedError()` first
- Automatically unsubscribes on unmount

## Composability

The hooks work seamlessly with other LazyPromise operators:

```tsx
import { useMemo } from "react";

function SearchResults({ query }: { query: string }) {
  const resultsPromise = useMemo(
    () =>
      search(query)
        .map(processResults)
        .catchRejection(() => []),
    [query],
  );

  const results = useLazyPromise(resultsPromise);

  return (
    <ul>
      {results.map((r) => (
        <li key={r.id}>{r.name}</li>
      ))}
    </ul>
  );
}
```

## Effects and Cancellation

For effect-style workflows, use native `useEffect` dependencies and subscribe with the exported `subscribe` helper. It calls `.subscribe` on a lazy promise and returns a teardown function expected by `useEffect`.

`subscribe` takes a single argument (the LazyPromise). Handle values/errors in the LazyPromise chain first using operators like `.map()`, `.catchRejection()`, and `.catchTypedError()`.

`subscribe` also rejects inputs that may resolve to `TypedError`; convert first with `.catchTypedError()` when needed.

```tsx
import { subscribe } from "@lazy-promise/react";
import { useEffect, useMemo } from "react";

function Component({ query }: { query: string }) {
  const task = useMemo(
    () =>
      search(query)
        .map((value) => {
          // update state
        })
        .catchRejection((error) => {
          // report error
        }),
    [query],
  );

  useEffect(() => subscribe(task), [task]);

  return null;
}
```

This gives automatic cancellation when dependencies change, while keeping React's existing dependency-linting behavior.
