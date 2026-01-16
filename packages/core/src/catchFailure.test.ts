import {
  catchFailure,
  LazyPromise,
  pipe,
  rejected,
  resolved,
} from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
  vi.useFakeTimers();
  logTime = Date.now();
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  vi.useRealTimers();
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

  // $ExpectType LazyPromise<"value a" | "value b", "error a">
  const promise1 = pipe(
    new LazyPromise<"value a", "error a">(() => {}),
    catchFailure(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value a" | "value b", "error a" | "error b">
  const promise2 = pipe(
    new LazyPromise<"value a", "error a">(() => {}),
    catchFailure(() => new LazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("falling back to a value", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    catchFailure((error) => error),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        "oops",
      ],
    ]
  `);
});

test("outer promise resolves", () => {
  const promise = pipe(
    resolved(1),
    catchFailure(() => undefined),
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

test("outer promise rejects", () => {
  const promise = pipe(
    rejected("a"),
    catchFailure(() => undefined),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "a",
      ],
    ]
  `);
});

test("inner promise resolves", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    catchFailure((error) => {
      log("caught", error);
      return resolved("b");
    }),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops",
      ],
      [
        "handleValue",
        "b",
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    catchFailure((error) => {
      log("caught", error);
      return rejected("b");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops",
      ],
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops 1");
    }),
    catchFailure((error) => {
      log("caught", error);
      return new LazyPromise((resolve, reject, fail) => {
        fail("oops 2");
      });
    }),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops 1",
      ],
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);
});

test("callback throws", () => {
  const promise = pipe(
    new LazyPromise((resolve, reject, fail) => {
      fail("oops 1");
    }),
    catchFailure(() => {
      throw "oops 2";
    }),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = pipe(
    new LazyPromise(() => () => {
      log("dispose");
    }),
    catchFailure(() => undefined),
  );
  const dispose = promise.subscribe();
  vi.advanceTimersByTime(500);
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
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    catchFailure(
      () =>
        new LazyPromise(() => () => {
          log("dispose");
        }),
    ),
  );
  const dispose = promise.subscribe();
  vi.advanceTimersByTime(500);
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
  let fail: (error: unknown) => void;
  const unsubscribe = pipe(
    new LazyPromise((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    catchFailure(() => {
      unsubscribe();
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
  fail!("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = pipe(
    new LazyPromise((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    catchFailure(() => {
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
  fail!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});
