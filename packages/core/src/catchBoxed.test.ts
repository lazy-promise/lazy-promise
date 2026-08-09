import type { Consumer, Sink } from "@lazy-promise/core";
import { box, ErrorBox, LazyPromise, rejecting } from "@lazy-promise/core";
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
    new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}).catchBoxed(
      (error) => {
        expectTypeOf(error).toEqualTypeOf<"error a">();
        return "value b" as const;
      },
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();

  expectTypeOf(
    new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}).catchBoxed(
      () => new LazyPromise<"value b" | ErrorBox<"error b">>(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<ErrorBox<"error b"> | "value a" | "value b">>();

  expectTypeOf(
    new LazyPromise<void, { outer: null }>(() => {}).catchBoxed(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (error, dep: { callback: null }) =>
        new LazyPromise<void, { inner: null }>(() => {}),
    ),
  ).toEqualTypeOf<
    LazyPromise<void, { outer: null } & { inner: null } & { callback: null }>
  >();
});

test("value of this", () => {
  const promise = box(new ErrorBox("error")).catchBoxed(function () {
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
  const promise = box(new ErrorBox(1)).catchBoxed((error) => error + 1);
  promise.subscribe(logConsumer);
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
  const promise = box(1).catchBoxed(() => undefined);
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

test("outer promise rejects", () => {
  const promise = new LazyPromise((sink) => {
    sink.reject("oops");
  }).catchBoxed(() => undefined);
  promise.subscribe(logConsumer);
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
  const promise = box(new ErrorBox("a")).catchBoxed(() => box("b"));
  promise.subscribe(logConsumer);
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
  const promise = box(new ErrorBox("a")).catchBoxed(() => rejecting("b"));
  promise.subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleError",
        "b",
      ],
    ]
  `);
});

test("callback throws", () => {
  const promise = box(new ErrorBox("a")).catchBoxed(() => {
    throw "oops";
  });
  promise.subscribe(logConsumer);
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
  const promise = new LazyPromise<never>(() => () => {
    log("dispose");
  }).catchBoxed((value) => value + 1);
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
  const promise = box(new ErrorBox("a")).catchBoxed(
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
  let sink: Sink<ErrorBox<number>>;
  const subscription = new LazyPromise<ErrorBox<number>>((sinkLocal) => {
    sink = sinkLocal;
  })
    .catchBoxed(() => {
      subscription.dispose();
    })
    .subscribe(logConsumer);
  sink!.resolve(new ErrorBox(1));
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let sink: Sink<ErrorBox<number>>;
  const subscription = new LazyPromise<ErrorBox<number>>((sinkLocal) => {
    sink = sinkLocal;
  })
    .catchBoxed(() => {
      subscription.dispose();
      throw "oops";
    })
    .subscribe(logConsumer);
  sink!.resolve(new ErrorBox(1));
});

test("dependency injection", () => {
  new LazyPromise<ErrorBox<void>, "dep">((sink, dep) => {
    log("outer promise dep", dep);
    sink.resolve(new ErrorBox(undefined));
  })
    .catchBoxed((error, dep: "dep") => {
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
