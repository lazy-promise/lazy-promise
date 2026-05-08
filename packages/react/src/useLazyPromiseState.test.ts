import { box, fromEager, LazyPromise, TypedError } from "@lazy-promise/core";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { useLazyPromiseState } from "./useLazyPromiseState";

// Compile-time type checks for the documented useLazyPromiseState usage.
const typeTests = () => {
  const typedErrorPromise = box(new TypedError("typed" as const));
  const fetchUser = (userId: string) => box({ name: userId });
  const fetchUserWithTypedError = (userId: string) =>
    box<{ name: string } | TypedError<"typed">>(
      userId === "typed" ? new TypedError("typed") : { name: userId },
    );

  // @ts-expect-error useLazyPromiseState input must not resolve to TypedError
  useLazyPromiseState(typedErrorPromise);

  // @ts-expect-error useLazyPromiseState input must not resolve to unions containing TypedError
  useLazyPromiseState(fetchUserWithTypedError("typed"));

  const UserProfile = ({ userId }: { userId: string }) => {
    const state = useLazyPromiseState(fetchUser(userId));

    expectTypeOf(state)
      .toHaveProperty("status")
      .toEqualTypeOf<"pending" | "success" | "error">();

    if (state.status === "pending") {
      expectTypeOf(state).toEqualTypeOf<{
        status: "pending";
        data?: never;
        error?: never;
      }>();
      return null;
    }

    if (state.status === "error") {
      expectTypeOf(state.error).toEqualTypeOf<unknown>();
      return null;
    }

    expectTypeOf(state.status).toEqualTypeOf<"success">();
    expectTypeOf(state.data.name).toEqualTypeOf<string>();
    return null;
  };

  const TypedErrorProfile = () => {
    const state = useLazyPromiseState(
      fetchUserWithTypedError("typed").catchTypedError((error) => {
        expectTypeOf(error).toEqualTypeOf<"typed">();
        return { name: "fallback" };
      }),
    );

    expectTypeOf(state)
      .toHaveProperty("status")
      .toEqualTypeOf<"pending" | "success" | "error">();

    if (state.status === "success") {
      expectTypeOf(state.data.name).toEqualTypeOf<string>();
    }

    return null;
  };

  const DestructuringExample = ({ userId }: { userId: string }) => {
    // Should support destructuring all properties - this verifies the API is ergonomic
    const { data, error, status } = useLazyPromiseState(fetchUser(userId));

    // Status should be properly typed as a union of the three states
    expectTypeOf(status).toEqualTypeOf<"pending" | "success" | "error">();

    // Data can be narrowed by checking status
    if (status === "success") {
      expectTypeOf(data).toEqualTypeOf<{ readonly name: string }>();
    }

    expectTypeOf(error).toEqualTypeOf<unknown>();

    return null;
  };

  return [UserProfile, TypedErrorProfile, DestructuringExample];
};

void typeTests;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useLazyPromiseState", () => {
  it("starts in pending state and resolves", async () => {
    vi.useFakeTimers();

    const lazyPromise = fromEager(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve("value");
          }, 10);
        }),
    );

    const { result } = renderHook(() => useLazyPromiseState(lazyPromise));

    expect(result.current).toEqual({ status: "pending" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current).toEqual({ status: "success", data: "value" });
  });

  it("captures rejection as error state", async () => {
    vi.useFakeTimers();
    const expected = new Error("boom");

    const lazyPromise = fromEager(
      () =>
        new Promise<string>((_, reject) => {
          setTimeout(() => {
            reject(expected);
          }, 10);
        }),
    );

    const { result } = renderHook(() => useLazyPromiseState(lazyPromise));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(result.current).toEqual({ status: "error", error: expected });
  });

  it("accepts catchTypedError-converted values", async () => {
    const lazyPromise = box(new TypedError("typed")).catchTypedError(
      () => "fallback",
    );

    const { result } = renderHook(() => useLazyPromiseState(lazyPromise));

    await waitFor(() => {
      expect(result.current).toEqual({ status: "success", data: "fallback" });
    });
  });

  it("unsubscribes on unmount", () => {
    let unsubscribed = false;

    const lazyPromise = new LazyPromise<string>(() => () => {
      unsubscribed = true;
    });

    const { unmount } = renderHook(() => useLazyPromiseState(lazyPromise));
    unmount();

    expect(unsubscribed).toBe(true);
  });

  it("cancels previous subscription when lazy promise reference changes", async () => {
    let firstUnsubscribed = false;

    const first = new LazyPromise<string>((subscriber) => {
      setTimeout(() => {
        subscriber.resolve("first");
      }, 20);
      return () => {
        firstUnsubscribed = true;
      };
    });

    const second = box("second");
    let current = first;

    const { result, rerender } = renderHook(() => useLazyPromiseState(current));

    expect(result.current).toEqual({ status: "pending" });

    current = second;
    rerender();

    expect(firstUnsubscribed).toBe(true);

    await waitFor(() => {
      expect(result.current).toEqual({ status: "success", data: "second" });
    });
  });

  it("ignores stale resolution from previous lazy promise after reference change", async () => {
    let resolveFirst!: (value: string) => void;

    const first = fromEager(
      () =>
        new Promise<string>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const second = box("second");
    let current = first;

    const { result, rerender } = renderHook(() => useLazyPromiseState(current));

    expect(result.current).toEqual({ status: "pending" });

    current = second;
    rerender();

    await waitFor(() => {
      expect(result.current).toEqual({ status: "success", data: "second" });
    });

    await act(async () => {
      resolveFirst("first");
      await Promise.resolve();
    });

    expect(result.current).toEqual({ status: "success", data: "second" });
  });
});
