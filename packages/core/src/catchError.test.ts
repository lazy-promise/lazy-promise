import { box, catchError, LazyPromise } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, expectTypeOf, test, vi } from "vitest";

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
  expectTypeOf(
    new LazyPromise<"value a">(() => {}).pipe(
      catchError(() => "value b" as const),
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();
});

test("falling back to a value", () => {
  const promise = new LazyPromise((resolve, reject) => {
    reject("oops");
  }).pipe(catchError((error) => error));
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
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
  const promise = box(1).pipe(catchError(() => undefined));
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

test("inner promise resolves", () => {
  const promise = new LazyPromise((resolve, reject) => {
    reject("oops");
  }).pipe(
    catchError((error) => {
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
  const promise = new LazyPromise((resolve, reject) => {
    reject("oops 1");
  }).pipe(
    catchError((error) => {
      log("caught", error);
      return new LazyPromise((resolve, reject) => {
        reject("oops 2");
      });
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "caught",
        "oops 1",
      ],
      [
        "handleError",
        "oops 2",
      ],
    ]
  `);
});

test("callback throws", () => {
  const promise = new LazyPromise((resolve, reject) => {
    reject("oops 1");
  }).pipe(
    catchError(() => {
      throw "oops 2";
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops 2",
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = new LazyPromise(() => () => {
    log("dispose");
  }).pipe(catchError(() => undefined));
  const unsubscribe = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  unsubscribe!();
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
  const promise = new LazyPromise((resolve, reject) => {
    reject("oops");
  }).pipe(
    catchError(
      () =>
        new LazyPromise(() => () => {
          log("dispose");
        }),
    ),
  );
  const unsubscribe = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  unsubscribe!();
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
  let reject: (error: unknown) => void;
  const unsubscribe = new LazyPromise((resolve, rejectLocal) => {
    reject = rejectLocal;
    return () => {};
  })
    .pipe(
      catchError(() => {
        unsubscribe!();
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleError");
      },
    );
  reject!("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let reject: (error: unknown) => void;
  const unsubscribe = new LazyPromise((resolve, rejectLocal) => {
    reject = rejectLocal;
    return () => {};
  })
    .pipe(
      catchError(() => {
        unsubscribe!();
        throw "oops";
      }),
    )
    .subscribe(
      () => {
        log("handleValue");
      },
      () => {
        log("handleError");
      },
    );
  reject!(1);
});
