export type NeverIfArrayContainsNever<T extends unknown[]> = T extends [
  infer First,
  ...infer Rest,
]
  ? [First] extends [never]
    ? never
    : [First, ...NeverIfArrayContainsNever<Rest>]
  : T;
