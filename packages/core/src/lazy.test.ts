import { afterEach, expect, test } from "vitest";
import { lazy } from "./lazy";

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

const DOMException =
  (globalThis as any).DOMException ??
  (() => {
    try {
      atob("~");
    } catch (err) {
      return Object.getPrototypeOf(err).constructor;
    }
  })();

test("source resolves", async () => {
  const promise = lazy(() => Promise.resolve("value"));
  promise.subscribe(
    (value) => {
      log("handleValue", value);
    },
    () => {},
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "value",
      ],
    ]
  `);
});

test("source rejects", async () => {
  const promise = lazy(() => Promise.reject("oops"));
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("source rejects with DOMException", async () => {
  const promise = lazy(() => Promise.reject(new DOMException()));
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure");
    expect(error).toBeInstanceOf(DOMException);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
});

test("callback throws", async () => {
  const promise = lazy(() => {
    throw "oops";
  });
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("cancelation", () => {
  const promise = lazy(
    (signal) =>
      new Promise((resolve, reject) => {
        log("produce");
        expect(signal.aborted).toBe(false);
        signal.addEventListener("abort", () => {
          log("handleAbort", signal.reason.toString());
          expect(signal.aborted).toBe(true);
          expect(signal.reason instanceof DOMException).toBe(true);
          reject(signal.reason);
        });
      }),
  );
  const dispose = promise.subscribe(undefined, () => {});
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "produce",
      ],
    ]
  `);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleAbort",
        "AbortError: The lazy promise no longer has any subscribers.",
      ],
    ]
  `);
});

test("un-aborted promise resolves", async () => {
  const promise = lazy(() => Promise.resolve(1));
  promise.subscribe()();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("un-aborted promise rejects", async () => {
  const promise = lazy(() => Promise.reject(1));
  promise.subscribe()();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
