import type {
  Consumer,
  NotAnErrorBox,
  Subscription,
  UnboxError,
} from "@lazy-promise/core";
import {
  box,
  ErrorBox,
  LazyPromise,
  never,
  rejecting,
} from "@lazy-promise/core";
import type {
  Consumer as InteropConsumer,
  ErrorBox as InteropErrorBox,
  NotAnErrorBox as InteropNotAnErrorBox,
  UnboxError as InteropUnboxError,
  LazyPromiseLike,
  SubscriptionLike,
} from "@lazy-promise/interop";
import {
  ErrorBox as InteropErrorBoxClass,
  isLazyPromiseLike,
} from "@lazy-promise/interop";
import { expect, expectTypeOf, test } from "vitest";

const emptySymbol = Symbol("empty");

// What a library that doesn't depend on core might write: pass a value
// through, or if it's a lazy promise, wait for it to settle synchronously.
const unboxSync = <Value>(
  source:
    | Value
    | (LazyPromiseLike<Value, any> & LazyPromiseLike<NotAnErrorBox, undefined>),
): Value => {
  if (!isLazyPromiseLike(source)) {
    return source;
  }
  let value: Value | typeof emptySymbol = emptySymbol;
  let error: unknown = emptySymbol;
  const subscription = (source as LazyPromiseLike<Value, undefined>).subscribe(
    {
      resolve: (resolvedValue) => {
        value = resolvedValue;
      },
      reject: (rejectionError) => {
        error = rejectionError;
      },
    },
    undefined,
  );
  if (error !== emptySymbol) {
    throw error;
  }
  if (value !== emptySymbol) {
    return value;
  }
  subscription.dispose();
  throw new Error("The lazy promise did not settle synchronously.");
};

test("types", () => {
  // Shared types are the same types.
  expectTypeOf<ErrorBox<"a">>().toEqualTypeOf<InteropErrorBox<"a">>();
  expectTypeOf<NotAnErrorBox>().toEqualTypeOf<InteropNotAnErrorBox>();
  expectTypeOf<UnboxError<ErrorBox<"a">>>().toEqualTypeOf<
    InteropUnboxError<ErrorBox<"a">>
  >();
  expectTypeOf<Consumer<1>>().toEqualTypeOf<InteropConsumer<1>>();

  // A LazyPromise is a LazyPromiseLike, not the other way around.
  expectTypeOf<LazyPromise<string, "dep">>().toExtend<
    LazyPromiseLike<string, "dep">
  >();
  expectTypeOf<LazyPromise<string>>().toExtend<LazyPromiseLike<string>>();
  expectTypeOf<LazyPromise<string>>().toExtend<
    LazyPromiseLike<string, "dep">
  >();
  expectTypeOf<LazyPromise<string, never>>().toExtend<
    LazyPromiseLike<unknown, never>
  >();
  expectTypeOf<LazyPromise<string | ErrorBox<"a">>>().toExtend<
    LazyPromiseLike<string | ErrorBox<"a">>
  >();
  expectTypeOf<LazyPromise<string | ErrorBox<"a">>>().not.toExtend<
    LazyPromiseLike<NotAnErrorBox>
  >();
  expectTypeOf<LazyPromise<string, "dep">>().not.toExtend<
    LazyPromiseLike<string, undefined>
  >();
  expectTypeOf<LazyPromise<string, "dep">>().not.toExtend<
    LazyPromiseLike<number, "dep">
  >();
  expectTypeOf<LazyPromiseLike<string>>().not.toExtend<LazyPromise<string>>();
  expectTypeOf<Subscription>().toExtend<SubscriptionLike>();

  expectTypeOf(unboxSync(box(42))).toEqualTypeOf<42>();
  expectTypeOf(unboxSync(42)).toEqualTypeOf<number>();
  expectTypeOf(unboxSync({ a: 1 })).toEqualTypeOf<{ a: number }>();
  expectTypeOf(unboxSync(null)).toEqualTypeOf<null>();
  expectTypeOf(unboxSync(undefined as string | undefined)).toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf(unboxSync(box(undefined as string | undefined))).toEqualTypeOf<
    string | undefined
  >();
  expectTypeOf(
    unboxSync(box("a" as const) as LazyPromise<"a", undefined>),
  ).toEqualTypeOf<"a">();
  expectTypeOf(
    unboxSync(box("a" as const) as LazyPromise<"a", "dep" | undefined>),
  ).toEqualTypeOf<"a">();
  expectTypeOf(unboxSync(box(1) as LazyPromise<1> | 2)).toEqualTypeOf<1 | 2>();
  expectTypeOf(
    unboxSync(box(1) as LazyPromise<1> | LazyPromise<2> | null),
  ).toEqualTypeOf<1 | 2 | null>();
  const rejected = () => {
    // @ts-expect-error Dependency.
    unboxSync(new LazyPromise<"a", "dep">(() => {}));
    // @ts-expect-error Dependency.
    unboxSync(new LazyPromise<"a", never>(() => {}));
    // @ts-expect-error Boxed error.
    unboxSync(new LazyPromise<"a" | ErrorBox<"e">>(() => {}));
    // @ts-expect-error Boxed error in a union.
    unboxSync(box(1) as LazyPromise<1 | ErrorBox<"e">> | 2);
  };
  rejected;

  const value: unknown = undefined;
  if (isLazyPromiseLike(value)) {
    expectTypeOf(value).toEqualTypeOf<LazyPromiseLike<unknown, never>>();
  }
  const union = never as LazyPromise<1, "dep"> | number;
  if (isLazyPromiseLike(union)) {
    expectTypeOf(union).toEqualTypeOf<LazyPromise<1, "dep">>();
  }
});

test("shared ErrorBox class", () => {
  expect(InteropErrorBoxClass).toBe(ErrorBox);
  const errorBox = new InteropErrorBoxClass("oops");
  box(errorBox)
    .catchBoxed((error) => {
      expectTypeOf(error).toEqualTypeOf<"oops">();
      return error;
    })
    .subscribe({
      resolve: (value) => {
        expect(value).toBe("oops");
      },
    });
});

test("isLazyPromiseLike", () => {
  expect(isLazyPromiseLike(box(1))).toBe(true);
  expect(isLazyPromiseLike(never)).toBe(true);
  expect(isLazyPromiseLike(new LazyPromise(() => {}))).toBe(true);
  expect(isLazyPromiseLike({ subscribe() {} })).toBe(false);
  expect(isLazyPromiseLike(Promise.resolve())).toBe(false);
});

test("unboxSync", () => {
  expect(unboxSync(42)).toBe(42);
  expect(
    unboxSync(
      new LazyPromise<string, undefined>((sink, dep) => {
        sink.resolve(String(dep));
      }),
    ),
  ).toBe("undefined");
  expect(() => unboxSync(rejecting("oops"))).toThrow("oops");
  let disposed = false;
  expect(() =>
    unboxSync(
      new LazyPromise<never>(() => () => {
        disposed = true;
      }),
    ),
  ).toThrow("did not settle synchronously");
  expect(disposed).toBe(true);
});
