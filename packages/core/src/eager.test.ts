import { expect, test } from "@jest/globals";
import { eager } from "./eager";
import { failed, rejected, resolved } from "./lazyPromise";

test("resolve", async () => {
  expect(await eager(resolved("value"))).toMatchInlineSnapshot(`"value"`);
});

test("reject", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() => eager(rejected("oops"))).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("fail", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() => eager(failed("oops"))).rejects.toMatchInlineSnapshot(`"oops"`);
});
