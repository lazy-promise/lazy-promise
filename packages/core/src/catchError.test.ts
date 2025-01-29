import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { catchError } from "./catchError";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
const logContents: unknown[] = [];
let logTime: number;

const log = (...args: unknown[]) => {
  const currentTime = Date.now();
  if (currentTime !== logTime) {
    logContents.push(`${currentTime - logTime} ms passed`);
    logTime = currentTime;
  }
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
  jest.useFakeTimers();
  logTime = Date.now();
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  jest.useRealTimers();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("types", () => {
  /* eslint-disable @typescript-eslint/no-unused-vars */

  // $ExpectType LazyPromise<"value a" | "value b", never>
  const promise1 = pipe(
    createLazyPromise<"value a", "error a">(() => {}),
    catchError(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value a" | "value b", "error b">
  const promise2 = pipe(
    createLazyPromise<"value a", "error a">(() => {}),
    catchError(() => createLazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("falling back to a value", () => {
  const promise = pipe(
    rejected(1),
    catchError((error) => error + 1),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        2,
      ],
    ]
  `);
});

test("outer promise resolves", () => {
  const promise = pipe(
    resolved(1),
    catchError(() => undefined),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("outer promise fails", () => {
  const promise = pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail();
    }),
    catchError(() => undefined),
  );
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure");
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
});

test("inner promise resolves", () => {
  const promise = pipe(
    rejected("a"),
    catchError(() => resolved("b")),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = pipe(
    rejected("a"),
    catchError(() => rejected("b")),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = pipe(
    rejected(1),
    catchError(() =>
      createLazyPromise((resolve, reject, fail) => {
        fail();
      }),
    ),
  );
  promise.subscribe(undefined, undefined, () => {
    log("handleFailure");
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
      ],
    ]
  `);
});

test("callback throws", () => {
  const promise = pipe(
    rejected(1),
    catchError(() => {
      throw "oops";
    }),
  );
  promise.subscribe(undefined, undefined, () => {
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

test("cancel outer promise", () => {
  const promise = pipe(
    createLazyPromise(() => () => {
      log("dispose");
    }),
    catchError((value) => value + 1),
  );
  const dispose = promise.subscribe();
  jest.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});

test("cancel inner promise", () => {
  const promise = pipe(
    rejected(1),
    catchError(() =>
      createLazyPromise(() => () => {
        log("dispose");
      }),
    ),
  );
  const dispose = promise.subscribe();
  jest.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});
