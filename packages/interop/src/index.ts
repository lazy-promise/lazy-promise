/**
 * Every LazyPromise has `true` under this key on its prototype. Used by
 * `@lazy-promise/core` to brand its instances; use `isLazyPromiseLike` to
 * check.
 */
export const lazyPromiseSymbol: unique symbol = Symbol("LazyPromise");

/**
 * Wraps a typed error so that it can be passed through the `resolve` channel.
 */
export class ErrorBox<const Error> {
  constructor(public readonly error: Error) {}
  // `NotAnErrorBox` has a public optional property of the same name, and a
  // private property never satisfies a public one.
  declare private __errorBoxBrand: never;
}

export type UnboxError<T> = T extends ErrorBox<infer Error> ? Error : never;

// An interface, not `{}`: an empty anonymous object type is dropped from
// intersections, and without the intersection `{ __errorBoxBrand?: ... }` is a
// weak type that rejects primitives and unrelated objects.
interface NonNullish {}

/**
 * Any value except an ErrorBox. `LazyPromise<NotAnErrorBox>` is the type of
 * LazyPromises that don't resolve to boxed errors.
 */
export type NotAnErrorBox =
  | ({ readonly __errorBoxBrand?: "NotAnErrorBox" } & NonNullish)
  | null
  | undefined
  | void;

export interface Consumer<Value> {
  resolve?: (value: Value) => void;
  reject?: (error: unknown) => void;
}

export interface SubscriptionLike {
  dispose(): void;
}

/**
 * The part of a LazyPromise that a library can use without depending on
 * `@lazy-promise/core`. Every `LazyPromise<Value, Dep>` is assignable to
 * `LazyPromiseLike<Value, Dep>`.
 */
export interface LazyPromiseLike<out Value, in Dep = unknown> {
  readonly [lazyPromiseSymbol]: true;
  readonly subscribe: (
    consumer: Consumer<Value> | undefined,
    dep: Dep,
  ) => SubscriptionLike;
}

export const isLazyPromiseLike = (
  value: unknown,
): value is LazyPromiseLike<unknown, never> =>
  typeof value === "object" &&
  value !== null &&
  (value as { [lazyPromiseSymbol]?: unknown })[lazyPromiseSymbol] === true;
