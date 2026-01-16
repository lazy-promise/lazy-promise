import {
  catchRejection,
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

  // $ExpectType LazyPromise<"value a" | "value b", never>
  const promise1 = pipe(
    new LazyPromise<"value a", "error a">(() => {}),
    catchRejection(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value a" | "value b", "error b">
  const promise2 = pipe(
    new LazyPromise<"value a", "error a">(() => {}),
    catchRejection(() => new LazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("falling back to a value", () => {
  const promise = pipe(
    rejected(1),
    catchRejection((error) => error + 1),
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
    catchRejection(() => undefined),
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
    new LazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    catchRejection(() => undefined),
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
    rejected("a"),
    catchRejection(() => resolved("b")),
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
    catchRejection(() => rejected("b")),
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
    catchRejection(
      () =>
        new LazyPromise((resolve, reject, fail) => {
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
    rejected(1),
    catchRejection(() => {
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
    new LazyPromise(() => () => {
      log("dispose");
    }),
    catchRejection((value) => value + 1),
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
    rejected(1),
    catchRejection(
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
  let reject: (error: number) => void;
  const unsubscribe = pipe(
    new LazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    catchRejection(() => {
      unsubscribe();
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
  );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let reject: (error: number) => void;
  const unsubscribe = pipe(
    new LazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    catchRejection(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
    () => {
      log("handleFailure");
    },
  );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});
