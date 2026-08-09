import type { Consumer, Sink } from "@lazy-promise/core";
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

const logConsumer: Consumer<any> = {
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
    new LazyPromise<"value a">(() => {}).catch(() => "value b" as const),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();

  expectTypeOf(
    new LazyPromise<void, { outer: null }>(() => {}).catch(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (error, dep: { callback: null }) =>
        new LazyPromise<void, { inner: null }>(() => {}),
    ),
  ).toEqualTypeOf<
    LazyPromise<void, { outer: null } & { inner: null } & { callback: null }>
  >();
});

test("value of this", () => {
  const promise = rejecting("error").catch(function () {
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
  const promise = new LazyPromise((sink) => {
    sink.reject("oops");
  }).catch((error) => error);
  promise.subscribe(logConsumer);
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
  const promise = box(1).catch(() => undefined);
  promise.subscribe(logConsumer);
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
  const promise = new LazyPromise((sink) => {
    sink.reject("oops");
  }).catch((error) => {
    log("caught", error);
    return box("b");
  });
  promise.subscribe(logConsumer);
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
  const promise = new LazyPromise((sink) => {
    sink.reject("oops 1");
  }).catch((error) => {
    log("caught", error);
    return new LazyPromise((sink) => {
      sink.reject("oops 2");
    });
  });
  promise.subscribe(logConsumer);
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
  const promise = new LazyPromise((sink) => {
    sink.reject("oops 1");
  }).catch(() => {
    throw "oops 2";
  });
  promise.subscribe(logConsumer);
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
  }).catch(() => undefined);
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.dispose();
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
  const promise = new LazyPromise<never>((sink) => {
    sink.reject("oops");
  }).catch(
    () =>
      new LazyPromise<never>(() => () => {
        log("dispose");
      }),
  );
  const subscription = promise.subscribe();
  vi.advanceTimersByTime(500);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.dispose();
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
  let sink: Sink<never>;
  const subscription = new LazyPromise<never>((sinkLocal) => {
    sink = sinkLocal;
  })
    .catch(() => {
      subscription.dispose();
    })
    .subscribe(logConsumer);
  sink!.reject("oops");
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let sink: Sink<never>;
  const subscription = new LazyPromise<never>((sinkLocal) => {
    sink = sinkLocal;
  })
    .catch(() => {
      subscription.dispose();
      throw "oops";
    })
    .subscribe(logConsumer);
  sink!.reject(1);
});

test("dependency injection", () => {
  new LazyPromise<never, "dep">((sink, dep) => {
    log("outer promise dep", dep);
    sink.reject("oops");
  })
    .catch((error, dep: "dep") => {
      log("callback dep", dep);
      return new LazyPromise<void, "dep">((sink, dep) => {
        log("inner promise dep", dep);
      });
    })
    .subscribe(undefined, "dep");

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "outer promise dep",
        "dep",
      ],
      [
        "callback dep",
        "dep",
      ],
      [
        "inner promise dep",
        "dep",
      ],
    ]
  `);
});
