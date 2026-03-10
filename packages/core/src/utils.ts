export type NeverIfArrayContainsNever<T extends unknown[]> = T extends [
  infer First,
  ...infer Rest,
]
  ? [First] extends [never]
    ? never
    : [First, ...NeverIfArrayContainsNever<Rest>]
  : T;

export type NeverIfRecordContainsNever<T> = {
  [Key in keyof T]: T[Key] extends never ? true : false;
}[keyof T] extends false
  ? T
  : never;
