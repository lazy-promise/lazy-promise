import type { ErrorBox } from "./lazyPromise.js";

/**
 * Surfaces an error nobody handles the same way an unhandled promise
 * rejection is surfaced.
 */
export const reportUnhandledError = (error: unknown) => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  Promise.reject(error);
};

export type NeverIfArrayContainsNever<T extends unknown[]> = T extends [
  infer First,
  ...infer Rest,
]
  ? [First] extends [never]
    ? never
    : [First, ...NeverIfArrayContainsNever<Rest>]
  : T;

export type NeverIfObjectContainsNever<T> = true extends {
  [Key in keyof T]: [T[Key]] extends [never] ? true : false;
}[keyof T]
  ? never
  : T;

export type ErrorBoxOrNever<Error> = [Error] extends [never]
  ? never
  : ErrorBox<Error>;

/**
 * Like `CreateDataProperty`: a plain assignment with the key `__proto__` would
 * set the prototype instead.
 */
export const setOwnProperty = (
  target: Record<PropertyKey, unknown>,
  key: PropertyKey,
  value: unknown,
) => {
  if (key === "__proto__") {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  target[key] = value;
};
