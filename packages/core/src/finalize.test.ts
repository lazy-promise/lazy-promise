import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import { box, LazyPromise, rejecting, TypedError } from "@lazy-promise/core";
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

const logSubscriber: Subscriber<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
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
  expectTypeOf(box(1).finalize(() => {})).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(box(1).finalize(() => box(2))).toEqualTypeOf<LazyPromise<1>>();

  expectTypeOf(box(new TypedError(1)).finalize(() => {})).toEqualTypeOf<
    LazyPromise<TypedError<1>>
  >();

  expectTypeOf(
    box(new TypedError(1)).finalize(() => new TypedError(2)),
  ).toEqualTypeOf<LazyPromise<TypedError<1> | TypedError<2>>>();

  expectTypeOf(
    box(new TypedError(1)).finalize(() => box(new TypedError(2))),
  ).toEqualTypeOf<LazyPromise<TypedError<1> | TypedError<2>>>();
});

test("value of this", () => {
  const promise = box(1).finalize(function () {
    /** @ts-expect-error */
    log("in callback", this);
  });
  promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "in callback",
        undefined,
      ],
    ]
  `);
});

test("source resolves", () => {
  const promise = box(1).finalize(() => {
    log("finalize");
  });
  promise.subscribe(logSubscriber);
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
  const promise = rejecting(1).finalize(() => {
    log("finalize");
  });
  promise.subscribe(logSubscriber);
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

test("callback returns a typed error", () => {
  const promise = box(1).finalize(() => new TypedError(1));
  promise.subscribe(logSubscriber);
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

test("callback throws", () => {
  box(1)
    .finalize(() => {
      throw "oops 1";
    })
    .subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops 1",
      ],
    ]
  `);

  rejecting(1)
    .finalize(() => {
      throw "oops 2";
    })
    .subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "oops 2",
      ],
    ]
  `);
});

test("unsubscribe in the callback (source resolves)", () => {
  let subscriber: InnerSubscriber<number>;
  const subscription = new LazyPromise<number>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .finalize(() => {
      subscription.unsubscribe();
    })
    .subscribe(logSubscriber);
  subscriber!.resolve(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source rejects)", () => {
  let subscriber: InnerSubscriber<never>;
  const subscription = new LazyPromise<never>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .finalize(() => {
      subscription.unsubscribe();
    })
    .subscribe(logSubscriber);
  subscriber!.reject(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback (source resolves)", () => {
  let subscriber: InnerSubscriber<number>;
  const subscription = new LazyPromise<number>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .finalize(() => {
      subscription.unsubscribe();
      throw "oops";
    })
    .subscribe(logSubscriber);
  subscriber!.resolve(1);
});

test("unsubscribe and throw in the callback (source rejects)", () => {
  let subscriber: InnerSubscriber<never>;
  const subscription = new LazyPromise<never>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .finalize(() => {
      subscription.unsubscribe();
      throw "oops";
    })
    .subscribe(logSubscriber);
  subscriber!.reject(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("inner promise resolves (source resolves)", () => {
  const promise = box(1).finalize(
    () =>
      new LazyPromise<2>((subscriber) => {
        setTimeout(() => {
          subscriber.resolve(2);
        }, 1000);
      }),
  );
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("inner promise resolves (source rejects)", () => {
  const promise = rejecting(1).finalize(
    () =>
      new LazyPromise<2>((subscriber) => {
        setTimeout(() => {
          subscriber.resolve(2);
        }, 1000);
      }),
  );
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "1000 ms passed",
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("inner promise resolves with a typed error (source resolves)", () => {
  const promise = box(new TypedError(1)).finalize(() => box(new TypedError(2)));
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise resolves with a typed error (source rejects)", () => {
  const promise = rejecting(1).finalize(() => box(new TypedError(2)));
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        TypedError {
          "error": 2,
        },
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = rejecting(1).finalize(() => rejecting(2));
  promise.subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        2,
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = new LazyPromise<never>(() => () => {
    log("dispose");
  }).finalize(() => undefined);
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.unsubscribe();
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
  const promise = box(1).finalize(
    () =>
      new LazyPromise(() => () => {
        log("dispose");
      }),
  );
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.unsubscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "500 ms passed",
      [
        "dispose",
      ],
    ]
  `);
});
