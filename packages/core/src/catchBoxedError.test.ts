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
    new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}).catchBoxedError(
      (error) => {
        expectTypeOf(error).toEqualTypeOf<"error a">();
        return "value b" as const;
      },
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();

  expectTypeOf(
    new LazyPromise<"value a" | ErrorBox<"error a">>(() => {}).catchBoxedError(
      () => new LazyPromise<"value b" | ErrorBox<"error b">>(() => {}),
    ),
  ).toEqualTypeOf<LazyPromise<ErrorBox<"error b"> | "value a" | "value b">>();
});

test("value of this", () => {
  const promise = box(new ErrorBox("error")).catchBoxedError(function () {
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
  const promise = box(new ErrorBox(1)).catchBoxedError((error) => error + 1);
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
  const promise = box(1).catchBoxedError(() => undefined);
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
  }).catchBoxedError(() => undefined);
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
  const promise = box(new ErrorBox("a")).catchBoxedError(() => box("b"));
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
  const promise = box(new ErrorBox("a")).catchBoxedError(() => rejecting("b"));
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
  const promise = box(new ErrorBox("a")).catchBoxedError(() => {
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
  }).catchBoxedError((value) => value + 1);
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
  const promise = box(new ErrorBox("a")).catchBoxedError(
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
    .catchBoxedError(() => {
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
    .catchBoxedError(() => {
      subscription.dispose();
      throw "oops";
    })
    .subscribe(logConsumer);
  sink!.resolve(new ErrorBox(1));
});
