import { expect, test } from "@jest/globals";
import { eager } from "./eager";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

test("resolve", async () => {
  expect(await eager(resolved("value"))).toMatchInlineSnapshot(`"value"`);
});

test("reject", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() => eager(rejected("oops"))).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("fail", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() =>
    eager(
      createLazyPromise((resolve, reject, fail) => {
        fail();
      }),
    ),
  ).rejects.toMatchInlineSnapshot(
    `[Error: The LazyPromise passed to eager(...) has failed.]`,
  );
});
