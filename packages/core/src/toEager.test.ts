import type { ErrorBox, Sink } from "@lazy-promise/core";
import { box, LazyPromise, never, rejecting } from "@lazy-promise/core";
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

afterEach(() => {
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

const flushMicrotasks = async () => {
  await new Promise((resolve) => {
    setTimeout(resolve);
  });
};

test("types", () => {
  /* eslint-disable @typescript-eslint/no-floating-promises */

  const promise1 = new LazyPromise<
    "value a" | ErrorBox<"error a"> | ErrorBox<"error b">
  >(() => {});

  /** @ts-expect-error */
  promise1.toEager();

  const promise2 = new LazyPromise<"value a">(() => {});

  expectTypeOf(promise2.toEager()).toEqualTypeOf<Promise<"value a">>();

  const promise3 = never as
    | LazyPromise<1 | ErrorBox<"error a">>
    | LazyPromise<2 | ErrorBox<"error b">>;

  /** @ts-expect-error */
  promise3.toEager();

  const promise4 = never as LazyPromise<1> | LazyPromise<2>;

  expectTypeOf(promise4.toEager()).toEqualTypeOf<Promise<1> | Promise<2>>();

  new LazyPromise<void, undefined>(() => {}).toEager();
  new LazyPromise<void, void>(() => {}).toEager();
  new LazyPromise<void, number | undefined>(() => {}).toEager();
  new LazyPromise<void, any>(() => {}).toEager();
  /** @ts-expect-error */
  new LazyPromise<void, "dep">(() => {}).toEager();
  /** @ts-expect-error */
  new LazyPromise<void, never>(() => {}).toEager();

  /* eslint-enable @typescript-eslint/no-floating-promises */
});

test("no signal, resolve", async () => {
  expect(await box("value").toEager()).toMatchInlineSnapshot(`"value"`);
});

test("no signal, reject", async () => {
  await expect(() => rejecting("oops").toEager()).rejects.toMatchInlineSnapshot(
    `"oops"`,
  );
});

test("signal, sync resolve", async () => {
  expect(
    await box("value").toEager({ signal: new AbortController().signal }),
  ).toMatchInlineSnapshot(`"value"`);
});

test("signal, async resolve", async () => {
  let sink: Sink<"value">;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  new LazyPromise<"value">((sinkLocal) => {
    sink = sinkLocal;
  })
    .toEager({ signal: new AbortController().signal })
    .then((value) => {
      log("resolve", value);
    });
  sink!.resolve("value");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        "value",
      ],
    ]
  `);
});

test("signal, sync reject", async () => {
  await expect(() =>
    rejecting("oops").toEager({ signal: new AbortController().signal }),
  ).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, async reject", async () => {
  let sink: Sink<never>;
  new LazyPromise<never>((sinkLocal) => {
    sink = sinkLocal;
  })
    .toEager({ signal: new AbortController().signal })
    .catch((error) => {
      log("rejected", error);
    });
  sink!.reject("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
        "oops",
      ],
    ]
  `);
});

test("already aborted signal", async () => {
  const abortController = new AbortController();
  abortController.abort("reason");
  await expect(() =>
    new LazyPromise<never>(() => {
      log("subscribe");
    }).toEager({ signal: abortController.signal }),
  ).rejects.toMatchInlineSnapshot(`"reason"`);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("signal aborted while subscribing", async () => {
  const abortController = new AbortController();
  const promise = new LazyPromise<never>(() => {
    log("subscribe");
    abortController.abort("reason");
    return () => {
      log("dispose");
    };
  }).toEager({ signal: abortController.signal });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
      [
        "dispose",
      ],
    ]
  `);
  await expect(() => promise).rejects.toMatchInlineSnapshot(`"reason"`);
});

test("signal aborted after subscribing", async () => {
  const abortController = new AbortController();
  new LazyPromise<never>(() => {
    log("subscribe");
    return () => {
      log("dispose");
    };
  })
    .toEager({ signal: abortController.signal })
    .catch((error) => {
      log("rejected", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
    ]
  `);
  abortController.abort("reason");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
        "reason",
      ],
    ]
  `);
});
