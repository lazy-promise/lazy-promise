import { afterEach, expect, test } from "@jest/globals";
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

test("resolve", async () => {
  const promise = lazy(() => Promise.resolve("value"));
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
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

test("reject", async () => {
  const promise = lazy(() => Promise.reject("oops"));
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
      ],
    ]
  `);
});

test("cancelation", () => {
  const promise = lazy(
    (signal) =>
      new Promise((_, reject) => {
        log("produce");
        expect(signal.aborted).toBe(false);
        signal.addEventListener("abort", () => {
          expect(signal.aborted).toBe(true);
          log("abort", signal.reason.toString());
          expect(signal.reason instanceof DOMException).toBe(true);
          reject(signal.reason);
        });
      }),
  );
  const dispose = promise.subscribe(undefined, () => {
    log("error");
  });
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
        "abort",
        "AbortError: The lazy promise no longer has any subscribers.",
      ],
    ]
  `);
});

test("un-aborted promise resolves", async () => {
  const promise = lazy(() => Promise.resolve(1));
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  )();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("un-aborted promise rejects", async () => {
  const promise = lazy(() => Promise.reject(1));
  promise.subscribe(
    (value) => {
      log("resolve", value);
    },
    (error) => {
      log("reject", error);
    },
  )();
  await flushMicrotasks();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
