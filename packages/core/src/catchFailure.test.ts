import { box, catchFailure, LazyPromise, rejected } from "@lazy-promise/core";
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
  const promise1 = new LazyPromise<"value a", "error a">(() => {}).pipe(
    catchFailure(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value a" | "value b", "error a" | "error b">
  const promise2 = new LazyPromise<"value a", "error a">(() => {}).pipe(
    catchFailure(() => new LazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("falling back to a value", () => {
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops");
  }).pipe(catchFailure((error) => error));
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
  const promise = box(1).pipe(catchFailure(() => undefined));
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
  const promise = rejected("a").pipe(catchFailure(() => undefined));
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleRejection",
        "a",
      ],
    ]
  `);
});

test("inner promise resolves", () => {
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops");
  }).pipe(
    catchFailure((error) => {
      log("caught", error);
      return box("b");
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
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops");
  }).pipe(
    catchFailure((error) => {
      log("caught", error);
      return rejected("b");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleRejection", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops",
      ],
      [
        "handleRejection",
        "b",
      ],
    ]
  `);
});

test("inner promise fails", () => {
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops 1");
  }).pipe(
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
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops 1");
  }).pipe(
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
  const promise = new LazyPromise(() => () => {
    log("dispose");
  }).pipe(catchFailure(() => undefined));
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
  const promise = new LazyPromise((resolve, reject, fail) => {
    fail("oops");
  }).pipe(
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
  const unsubscribe = new LazyPromise((resolve, reject, failLocal) => {
    fail = failLocal;
    return () => {};
  })
    .pipe(
      catchFailure(() => {
        unsubscribe();
      }),
    )
    .subscribe(
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
  const unsubscribe = new LazyPromise((resolve, reject, failLocal) => {
    fail = failLocal;
    return () => {};
  })
    .pipe(
      catchFailure(() => {
        unsubscribe();
        throw "oops";
      }),
    )
    .subscribe(
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
