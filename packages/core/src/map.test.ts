import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";
import { map } from "./map";

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

  // $ExpectType LazyPromise<"value b", "error a">
  const promise1 = pipe(
    createLazyPromise<"value a", "error a">(() => {}),
    map(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value b", "error a" | "error b">
  const promise2 = pipe(
    createLazyPromise<"value a", "error a">(() => {}),
    map(() => createLazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("mapping to a value", () => {
  const promise = pipe(
    resolved(1),
    map((value) => value + 1),
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

test("outer promise rejects", () => {
  const promise = pipe(
    rejected("oops"),
    map(() => undefined),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("outer promise fails", () => {
  const promise = pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    map(() => undefined),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("inner promise resolves", () => {
  const promise = pipe(
    resolved(1),
    map(() => resolved(1)),
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

test("inner promise rejects", () => {
  const promise = pipe(
    resolved(1),
    map(() => rejected("oops")),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops",
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = pipe(
    resolved(1),
    map(() =>
      createLazyPromise((resolve, reject, fail) => {
        fail("oops");
      }),
    ),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("callback throws", () => {
  const promise = pipe(
    resolved(1),
    map(() => {
      throw "oops";
    }),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = pipe(
    createLazyPromise(() => () => {
      log("dispose");
    }),
    map(() => undefined),
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
    resolved(1),
    map(() =>
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

test("unsubscribe in the callback", () => {
  let resolve: (value: number) => void;
  const unsubscribe = pipe(
    createLazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    map(() => {
      unsubscribe();
    }),
  ).subscribe(() => {
    log("handleValue");
  });
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let resolve: (value: number) => void;
  const unsubscribe = pipe(
    createLazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    map(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    undefined,
    () => {
      log("handleFailure");
    },
  );
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});
