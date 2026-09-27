import type {
  Consumer,
  LazyPromiseLike,
  NotAnErrorBox,
  SubscriptionLike,
  UnboxError,
} from "@lazy-promise/interop";
import {
  ErrorBox,
  isLazyPromiseLike,
  lazyPromiseSymbol,
} from "@lazy-promise/interop";
import { expect, expectTypeOf, test } from "vitest";

test("types", () => {
  expectTypeOf<string>().toExtend<NotAnErrorBox>();
  expectTypeOf<{ error: string }>().toExtend<NotAnErrorBox>();
  expectTypeOf<void>().toExtend<NotAnErrorBox>();
  expectTypeOf<ErrorBox<"oops">>().not.toExtend<NotAnErrorBox>();
  expectTypeOf<ErrorBox<undefined>>().not.toExtend<NotAnErrorBox>();
  expectTypeOf<1 | ErrorBox<1>>().not.toExtend<NotAnErrorBox>();
  expectTypeOf({ error: "a" }).not.toExtend<ErrorBox<string>>();

  expectTypeOf<
    UnboxError<number | ErrorBox<"a"> | ErrorBox<"b">>
  >().toEqualTypeOf<"a" | "b">();
  expectTypeOf<UnboxError<number>>().toEqualTypeOf<never>();

  expectTypeOf<LazyPromiseLike<"a">>().toExtend<LazyPromiseLike<string>>();
  expectTypeOf<LazyPromiseLike<string>>().not.toExtend<LazyPromiseLike<"a">>();
  expectTypeOf<LazyPromiseLike<void, string>>().toExtend<
    LazyPromiseLike<void, "a">
  >();
  expectTypeOf<LazyPromiseLike<void, "a">>().not.toExtend<
    LazyPromiseLike<void, string>
  >();
  expectTypeOf<LazyPromiseLike<void, never>>().toExtend<
    LazyPromiseLike<unknown, never>
  >();

  const value: unknown = undefined;
  if (isLazyPromiseLike(value)) {
    expectTypeOf(value).toEqualTypeOf<LazyPromiseLike<unknown, never>>();
  }
  const union = undefined as unknown as LazyPromiseLike<1, "dep"> | number;
  if (isLazyPromiseLike(union)) {
    expectTypeOf(union).toEqualTypeOf<LazyPromiseLike<1, "dep">>();
  }
});

test("ErrorBox", () => {
  const errorBox = new ErrorBox("oops");
  expect(errorBox.error).toBe("oops");
  expect(errorBox instanceof ErrorBox).toBe(true);
  expect(Object.keys(errorBox)).toEqual(["error"]);
});

test("isLazyPromiseLike", () => {
  const lazyPromise: LazyPromiseLike<string, "dep"> = {
    [lazyPromiseSymbol]: true,
    subscribe: (consumer: Consumer<string> | undefined, dep: "dep") => {
      consumer?.resolve?.(dep);
      const subscription: SubscriptionLike = { dispose() {} };
      return subscription;
    },
  };
  expect(isLazyPromiseLike(lazyPromise)).toBe(true);
  expect(isLazyPromiseLike({ subscribe() {} })).toBe(false);
  expect(isLazyPromiseLike({ [lazyPromiseSymbol]: 1 })).toBe(false);
  expect(isLazyPromiseLike(42)).toBe(false);
  expect(isLazyPromiseLike(null)).toBe(false);
  expect(isLazyPromiseLike(undefined)).toBe(false);
});
