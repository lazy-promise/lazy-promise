import {
  box,
  fromEager,
  LazyPromise,
  rejecting,
  TypedError,
} from "@lazy-promise/core";
import { useEffect, useMemo } from "react";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { subscribe } from "./subscribe";

// Compile-time type checks for the documented subscribe usage.
const typeTests = () => {
  const typedErrorTask = box(new TypedError("boom" as const));

  // @ts-expect-error subscribe input must not resolve to TypedError
  subscribe(typedErrorTask);

  const handledTypedErrorTask = typedErrorTask.catchTypedError(
    (error) => `handled:${error}` as const,
  );
  expectTypeOf(handledTypedErrorTask).toEqualTypeOf<
    LazyPromise<"handled:boom">
  >();

  const task = fromEager(({ signal }) => {
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
    return ["a"] as string[];
  });

  const cleanup = subscribe(task.map((value) => value));

  expectTypeOf(cleanup).toEqualTypeOf<() => void>();

  subscribe(handledTypedErrorTask.map((value) => value));

  const UserSearch = ({ query }: { query: string }) => {
    const task = useMemo(
      () =>
        fromEager(({ signal }) => {
          expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
          return { items: [query] as string[] };
        })
          .map((data) => data.items)
          .catchRejection(() => [] as string[]),
      [query],
    );

    useEffect(() => subscribe(task), [task]);

    return null;
  };

  return [cleanup, UserSearch];
};

void typeTests;

afterEach(() => {
  vi.useRealTimers();
});

describe("subscribe", () => {
  it("returns cleanup that unsubscribes the subscription", () => {
    let unsubscribedCount = 0;

    const lazyPromise = new LazyPromise<void>(() => () => {
      unsubscribedCount++;
    });

    const cleanup = subscribe(lazyPromise);

    cleanup();
    cleanup();

    expect(unsubscribedCount).toBe(1);
  });

  it("starts promise chains so map/catchRejection side effects run", async () => {
    let resolved: string | undefined;
    let rejected: unknown;

    subscribe(
      fromEager(() => Promise.resolve("value")).map((value) => {
        resolved = value;
        return value;
      }),
    );

    subscribe(
      rejecting("oops").catchRejection((error) => {
        rejected = error;
        return "fallback";
      }),
    );

    await Promise.resolve();

    expect(resolved).toBe("value");
    expect(rejected).toBe("oops");
  });

  it("cleanup cancels pending chain before map side effects run", async () => {
    vi.useFakeTimers();
    let mapped = false;

    const cleanup = subscribe(
      fromEager(
        ({ signal }) =>
          new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve("value");
            }, 10);

            signal.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(signal.reason);
            });
          }),
      )
        .map((value) => {
          mapped = true;
          return value;
        })
        .catchRejection(() => "fallback"),
    );

    cleanup();
    await vi.advanceTimersByTimeAsync(20);

    expect(mapped).toBe(false);
  });
});
