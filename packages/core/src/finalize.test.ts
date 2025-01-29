import { afterEach, beforeEach, expect, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { finalize } from "./finalize";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
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

const processMockMicrotaskQueue = () => {
  while (mockMicrotaskQueue.length) {
    mockMicrotaskQueue.shift()!();
  }
};

beforeEach(() => {
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("source resolves", () => {
  const promise = pipe(
    resolved(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("source rejects", () => {
  const promise = pipe(
    rejected(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("source fails", () => {
  const promise = pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail();
    }),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure");
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleFailure",
      ],
    ]
  `);
});

test("callback throws", () => {
  pipe(
    resolved(1),
    finalize(() => {
      throw "oops";
    }),
  ).subscribe(undefined, undefined, () => {
    log("handleFailure");
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");

  pipe(
    rejected(1),
    finalize(() => {
      throw "oops";
    }),
  ).subscribe(
    undefined,
    () => {},
    () => {
      log("handleFailure");
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");

  pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail();
    }),
    finalize(() => {
      throw "oops";
    }),
  ).subscribe(undefined, undefined, () => {
    log("handleFailure");
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
  expect(processMockMicrotaskQueue).toThrow("oops");
});
