import type { LazyPromise, TypedError } from "@lazy-promise/core";
import { useEffect, useState } from "react";

/**
 * State returned by `useLazyPromiseState`.
 */
export type LazyPromiseState<T> =
  | {
      status: "pending";
      data?: never;
      error?: never;
    }
  | {
      status: "success";
      data: T;
      error?: never;
    }
  | {
      status: "error";
      data?: never;
      error: unknown;
    };

/**
 * Hooks a LazyPromise without using Suspense, returning an object with the
 * state instead. Useful when you need more control over loading/error states.
 *
 * The input LazyPromise must not resolve to a TypedError — use
 * `.catchTypedError()` before passing to this hook if you need to handle typed
 * errors.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const state = useLazyPromiseState(lazyPromise);
 *
 *   if (state.status === "pending") return <div>Loading...</div>;
 *   if (state.status === "error") return <div>Error: {String(state.error)}</div>;
 *   return <div>{state.data}</div>;
 * }
 * ```
 */
const useLazyPromiseStateImpl = <T>(
  lazyPromise: LazyPromise<T>,
): LazyPromiseState<T> => {
  const [state, setState] = useState<LazyPromiseState<any>>({
    status: "pending",
  });

  useEffect(() => {
    setState({ status: "pending" });

    const subscription = lazyPromise.subscribe({
      resolve: (value: any) => {
        setState({ status: "success", data: value });
      },
      reject: (error: unknown) => {
        setState({ status: "error", error });
      },
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [lazyPromise]);

  return state;
};

export const useLazyPromiseState: <T>(
  lazyPromise: Extract<T, TypedError<any>> extends never
    ? LazyPromise<T>
    : never,
) => LazyPromiseState<T> = useLazyPromiseStateImpl as any;
