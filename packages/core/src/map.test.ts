import {
  box,
  LazyPromise,
  map,
  rejected,
  TypedError,
} from "@lazy-promise/core";
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
    new LazyPromise<"value a" | TypedError<"error a">>(() => {}).pipe(
      map((value) => {
        expectTypeOf(value).toEqualTypeOf<"value a">();
        return "value b" as const;
      }),
    ),
  ).toEqualTypeOf<LazyPromise<TypedError<"error a"> | "value b">>();

  expectTypeOf(
    new LazyPromise<"value a" | TypedError<"error a">>(() => {}).pipe(
      map(() => new LazyPromise<"value b" | TypedError<"error b">>(() => {})),
    ),
  ).toEqualTypeOf<
    LazyPromise<"value b" | TypedError<"error a"> | TypedError<"error b">>
  >();
});

test("mapping to a value", () => {
  const promise = box(1).pipe(map((value) => value + 1));
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        2,
      ],
    ]
  `);
});

test("outer promise resolves with a typed error", () => {
  const promise = box(new TypedError(1)).pipe(map((value) => value + 1));
  const unsubscribe = promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 1,
        },
      ],
    ]
  `);
});

test("outer promise rejects", () => {
  const promise = rejected("oops").pipe(map(() => undefined));
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

test("inner promise resolves", () => {
  const promise = box(1).pipe(map(() => box(2)));
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

test("inner promise rejects", () => {
  const promise = box(1).pipe(map(() => rejected("oops")));
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

test("callback throws", () => {
  const promise = box(1).pipe(
    map(() => {
      throw "oops";
    }),
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

test("cancel outer promise", () => {
  const promise = new LazyPromise(() => () => {
    log("dispose");
  }).pipe(map(() => undefined));
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
  const promise = box(1).pipe(
    map(
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
  let resolve: (value: number) => void;
  const unsubscribe = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  })
    .pipe(
      map(() => {
        unsubscribe!();
      }),
    )
    .subscribe(() => {
      log("handleValue");
    });
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let resolve: (value: number) => void;
  const unsubscribe = new LazyPromise((resolveLocal) => {
    resolve = resolveLocal;
    return () => {};
  })
    .pipe(
      map(() => {
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
  resolve!(1);
});
