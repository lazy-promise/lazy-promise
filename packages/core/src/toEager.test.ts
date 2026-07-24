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

  promise1.toEager<"error a" | "error b">();

  promise1.toEager<"error a" | "error b" | "error c">();

  promise1.toEager<unknown>();

  promise1.toEager<any>();

  /** @ts-expect-error */
  promise1.toEager();

  /** @ts-expect-error */
  promise1.toEager<"error a">();

  const promise2 = new LazyPromise<"value a">(() => {});

  promise2.toEager();

  promise2.toEager<"error a">();

  const promise3 = never as
    | LazyPromise<1 | ErrorBox<"error a">>
    | LazyPromise<2 | ErrorBox<"error b">>;

  const nativePromise3 = promise3.toEager<"error a" | "error b">();
  expectTypeOf(nativePromise3).toEqualTypeOf<
    Promise<ErrorBox<"error a"> | 1> | Promise<ErrorBox<"error b"> | 2>
  >();

  /** @ts-expect-error */
  promise3.toEager();

  /** @ts-expect-error */
  promise3.toEager<"error a">();

  /** @ts-expect-error */
  promise3.toEager<"error b">();

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
