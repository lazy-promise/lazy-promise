import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import { box, LazyPromise, rejecting } from "@lazy-promise/core";
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
  expectTypeOf(
    new LazyPromise<"value a">(() => {}).catchRejection(
      () => "value b" as const,
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();
});

test("value of this", () => {
  const promise = rejecting("error").catchRejection(function () {
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

test("falling back to a value", () => {
  const promise = new LazyPromise((subscriber) => {
    subscriber.reject("oops");
  }).catchRejection((error) => error);
  promise.subscribe(logSubscriber);
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
  const promise = box(1).catchRejection(() => undefined);
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise((subscriber) => {
    subscriber.reject("oops");
  }).catchRejection((error) => {
    log("caught", error);
    return box("b");
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise((subscriber) => {
    subscriber.reject("oops 1");
  }).catchRejection((error) => {
    log("caught", error);
    return new LazyPromise((subscriber) => {
      subscriber.reject("oops 2");
    });
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise((subscriber) => {
    subscriber.reject("oops 1");
  }).catchRejection(() => {
    throw "oops 2";
  });
  promise.subscribe(logSubscriber);
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
  const promise = new LazyPromise<never>(() => () => {
    log("dispose");
  }).catchRejection(() => undefined);
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
  const promise = new LazyPromise<never>((subscriber) => {
    subscriber.reject("oops");
  }).catchRejection(
    () =>
      new LazyPromise<never>(() => () => {
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

test("unsubscribe in the callback", () => {
  let subscriber: InnerSubscriber<never>;
  const subscription = new LazyPromise<never>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .catchRejection(() => {
      subscription.unsubscribe();
    })
    .subscribe(logSubscriber);
  subscriber!.reject("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let subscriber: InnerSubscriber<never>;
  const subscription = new LazyPromise<never>((subscriberLocal) => {
    subscriber = subscriberLocal;
  })
    .catchRejection(() => {
      subscription.unsubscribe();
      throw "oops";
    })
    .subscribe(logSubscriber);
  subscriber!.reject(1);
});
