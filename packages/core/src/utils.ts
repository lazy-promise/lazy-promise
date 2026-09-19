import type { ErrorBox } from "./lazyPromise.js";

export const throwInMicrotask = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
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

export type ErrorBoxOrNever<Error> = Error extends never
  ? never
  : ErrorBox<Error>;
