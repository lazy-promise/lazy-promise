import { expect, test } from "vitest";
import { pipe } from "./pipe";

const addSuffix =
  <Suffix extends string>(suffix: Suffix) =>
  <Base extends string>(base: Base): `${Base}-${Suffix}` =>
    `${base}-${suffix}`;

test("pipe", () => {
  // $ExpectType "base"
  const result = pipe("base" as const);
  expect(result).toMatchInlineSnapshot(`"base"`);

  expect(
    // $ExpectType "base-a"
    pipe("base" as const, addSuffix("a")),
  ).toMatchInlineSnapshot(`"base-a"`);

  // $ExpectType "base-a-b"
  pipe("base" as const, addSuffix("a"), addSuffix("b"));

  // $ExpectType "base-a-b-c"
  pipe("base" as const, addSuffix("a"), addSuffix("b"), addSuffix("c"));

  // $ExpectType "base-a-b-c-d"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
  );

  // $ExpectType "base-a-b-c-d-e"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
  );

  // $ExpectType "base-a-b-c-d-e-f"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
    addSuffix("o"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
    addSuffix("o"),
    addSuffix("p"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
    addSuffix("o"),
    addSuffix("p"),
    addSuffix("q"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
    addSuffix("o"),
    addSuffix("p"),
    addSuffix("q"),
    addSuffix("r"),
  );

  // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s"
  pipe(
    "base" as const,
    addSuffix("a"),
    addSuffix("b"),
    addSuffix("c"),
    addSuffix("d"),
    addSuffix("e"),
    addSuffix("f"),
    addSuffix("g"),
    addSuffix("h"),
    addSuffix("i"),
    addSuffix("j"),
    addSuffix("k"),
    addSuffix("l"),
    addSuffix("m"),
    addSuffix("n"),
    addSuffix("o"),
    addSuffix("p"),
    addSuffix("q"),
    addSuffix("r"),
    addSuffix("s"),
  );

  expect(
    // $ExpectType "base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s"
    pipe(
      "base" as const,
      addSuffix("a"),
      addSuffix("b"),
      addSuffix("c"),
      addSuffix("d"),
      addSuffix("e"),
      addSuffix("f"),
      addSuffix("g"),
      addSuffix("h"),
      addSuffix("i"),
      addSuffix("j"),
      addSuffix("k"),
      addSuffix("l"),
      addSuffix("m"),
      addSuffix("n"),
      addSuffix("o"),
      addSuffix("p"),
      addSuffix("q"),
      addSuffix("r"),
      addSuffix("s"),
    ),
  ).toMatchInlineSnapshot(`"base-a-b-c-d-e-f-g-h-i-j-k-l-m-n-o-p-q-r-s"`);
});
