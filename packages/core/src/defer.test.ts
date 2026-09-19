import type { Consumer } from "@lazy-promise/core";
import { box, defer, ErrorBox, LazyPromise } from "@lazy-promise/core";
import { afterEach, expect, expectTypeOf, test } from "vitest";

const logContents: unknown[] = [];

const log = (...args: unknown[]) => {
  logContents.push(args);
};

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

afterEach(() => {
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("types", () => {
  expectTypeOf(defer(() => "a" as const)).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(defer(() => box("a"))).toEqualTypeOf<LazyPromise<"a">>();

  expectTypeOf(
    defer(() => {
      if (true as boolean) {
        return "a";
      }
      return box("b");
    }),
  ).toEqualTypeOf<LazyPromise<"a" | "b">>();

  expectTypeOf(
    defer(() => {
      if (true as boolean) {
        return box(new ErrorBox("error1"));
      }
      return "a";
    }),
  ).toEqualTypeOf<LazyPromise<"a" | ErrorBox<"error1">>>();

  expectTypeOf(
    defer(() => {
      throw 1;
    }),
  ).toEqualTypeOf<LazyPromise<never>>();

  expectTypeOf(
    defer(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (dep: { callback: null }) =>
        new LazyPromise<void, { returned: null }>(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<void, { callback: null } & { returned: null }>>();

  // Return generic type.
  const f = <T>(arg: T) => defer(() => arg).map((x) => x);
  expectTypeOf(f("a" as const)).toEqualTypeOf<LazyPromise<"a">>();
});

test("lazy", () => {
  const lazyPromise = defer(() => {
    log("callback");
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  lazyPromise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback",
      ],
    ]
  `);
  lazyPromise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback",
      ],
    ]
  `);
});

test("resolve with a value", () => {
  defer(() => "a").subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("resolve with a LazyPromise", () => {
  defer(() => box("a")).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "a",
      ],
    ]
  `);
});

test("callback throws", () => {
  defer(() => {
    throw "oops";
  }).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("dispose", () => {
  defer(
    () =>
      new LazyPromise<never>(() => () => {
        log("teardown");
      }),
  )
    .subscribe(logConsumer)
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "teardown",
      ],
    ]
  `);
});

test("dependency injection", () => {
  defer((dep: "dep") => {
    log("callback dep", dep);
    return new LazyPromise<void, "dep">((sink, dep) => {
      log("returned promise dep", dep);
    });
  }).subscribe(undefined, "dep");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback dep",
        "dep",
      ],
      [
        "returned promise dep",
        "dep",
      ],
    ]
  `);
});
