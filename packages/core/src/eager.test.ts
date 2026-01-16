import {
  eager,
  failed,
  LazyPromise,
  rejected,
  resolved,
} from "@lazy-promise/core";
import { afterEach, expect, test } from "vitest";

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

test("no signal, reject", async () => {
  let error;
  try {
    await eager(rejected("oops") as LazyPromise<never, never>);
  } catch (errorLocal) {
    error = errorLocal;
  }
  if (!(error instanceof Error)) {
    throw new Error("fail");
  }
  expect(error.message).toMatchInlineSnapshot(
    `"The lazy promise passed to eager(...) has rejected. The original error has been stored as the .cause property."`,
  );
  expect(error.cause).toMatchInlineSnapshot(`"oops"`);
});

test("no signal, fail", async () => {
  await expect(() => eager(failed("oops"))).rejects.toMatchInlineSnapshot(
    `"oops"`,
  );
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
    new LazyPromise((resolveLocal) => {
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

test("signal, sync reject", async () => {
  let error;
  try {
    await eager(
      rejected("oops") as LazyPromise<never, never>,
      new AbortController().signal,
    );
  } catch (errorLocal) {
    error = errorLocal;
  }
  if (!(error instanceof Error)) {
    throw new Error("fail");
  }
  expect(error.message).toMatchInlineSnapshot(
    `"The lazy promise passed to eager(...) has rejected. The original error has been stored as the .cause property."`,
  );
  expect(error.cause).toMatchInlineSnapshot(`"oops"`);
});

test("signal, async reject", async () => {
  let reject: (error: "oops") => void;
  eager(
    new LazyPromise<never, "oops">((resolve, rejectLocal) => {
      reject = rejectLocal;
    }) as LazyPromise<never, never>,
    new AbortController().signal,
  ).catch((error) => {
    log("rejected");
    if (!(error instanceof Error)) {
      throw new Error("fail");
    }
    expect(error.message).toMatchInlineSnapshot(
      `"The lazy promise passed to eager(...) has rejected. The original error has been stored as the .cause property."`,
    );
    expect(error.cause).toMatchInlineSnapshot(`"oops"`);
  });
  reject!("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "rejected",
      ],
    ]
  `);
});

test("signal, sync fail", async () => {
  await expect(() =>
    eager(failed("oops"), new AbortController().signal),
  ).rejects.toMatchInlineSnapshot(`"oops"`);
});

test("signal, async fail", async () => {
  let fail: (error: "oops") => void;
  eager(
    new LazyPromise((resolve, reject, failLocal) => {
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

test("already aborted signal", async () => {
  const abortController = new AbortController();
  abortController.abort("reason");
  await expect(() =>
    eager(
      new LazyPromise<never, never>(() => {
        log("subscribe");
      }),
      abortController.signal,
    ),
  ).rejects.toMatchInlineSnapshot(`"reason"`);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("signal aborted while subscribing", async () => {
  const abortController = new AbortController();
  const promise = eager(
    new LazyPromise<never, never>(() => {
      log("subscribe");
      abortController.abort("reason");
      return () => {
        log("unsubscribe");
      };
    }),
    abortController.signal,
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "subscribe",
      ],
      [
        "unsubscribe",
      ],
    ]
  `);
  await expect(() => promise).rejects.toMatchInlineSnapshot(`"reason"`);
});

test("signal aborted after subscribing", async () => {
  const abortController = new AbortController();
  eager(
    new LazyPromise<never, never>(() => {
      log("subscribe");
      return () => {
        log("unsubscribe");
      };
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
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "unsubscribe",
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
