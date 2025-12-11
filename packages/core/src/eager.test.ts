import { afterEach, expect, test } from "@jest/globals";
import { eager } from "./eager";
import { createLazyPromise, failed, rejected, resolved } from "./lazyPromise";

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

test("no signal, resolve", async () => {
  expect(await eager(resolved("value"))).toMatchInlineSnapshot(`"value"`);
});

test("no signal, reject", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() => eager(rejected("oops"))).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("no signal, fail", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() => eager(failed("oops"))).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, sync resolve", async () => {
  expect(
    await eager(resolved("value"), new AbortController().signal),
  ).toMatchInlineSnapshot(`"value"`);
});

test("signal, async resolve", async () => {
  let resolve: (value: "value") => void;
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  eager(
    createLazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    new AbortController().signal,
  ).then((value) => {
    log("resolved", value);
  });
  resolve!("value");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolved",
        "value",
      ],
    ]
  `);
});

test("signal, sync reject", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() =>
    eager(rejected("oops"), new AbortController().signal),
  ).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, async reject", async () => {
  let reject: (error: "oops") => void;
  eager(
    createLazyPromise((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    new AbortController().signal,
  ).catch((error) => {
    log("rejected", error);
  });
  reject!("oops");
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

test("signal, sync fail", () => {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() =>
    eager(failed("oops"), new AbortController().signal),
  ).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, async fail", async () => {
  let fail: (error: "oops") => void;
  eager(
    createLazyPromise((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    new AbortController().signal,
  ).catch((error) => {
    log("rejected", error);
  });
  fail!("oops");
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

test("already aborted signal", () => {
  const abortController = new AbortController();
  abortController.abort("reason");
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() =>
    eager(
      createLazyPromise<never, never>(() => {
        log("subscribe");
      }),
      abortController.signal,
    ),
  ).rejects.toMatchInlineSnapshot(`"reason"`);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("signal aborted while subscribing", () => {
  const abortController = new AbortController();
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  expect(() =>
    eager(
      createLazyPromise<never, never>(() => {
        log("subscribe");
        abortController.abort("reason");
      }),
      abortController.signal,
    ),
  ).rejects.toMatchInlineSnapshot(`"reason"`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
    ]
  `);
});

test("signal aborted after subscribing", async () => {
  const abortController = new AbortController();
  eager(
    createLazyPromise<never, never>(() => {
      log("subscribe");
    }),
    abortController.signal,
  ).catch((error) => {
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
  expect(readLog()).toMatchInlineSnapshot(`[]`);
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
