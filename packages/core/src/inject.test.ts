import type { Consumer } from "@lazy-promise/core";
import { box, LazyPromise } from "@lazy-promise/core";
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
    new LazyPromise<"value", { upstream: null }>(() => {}).inject(
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (dep: { callback: null }) => ({ upstream: null }),
    ),
  ).toEqualTypeOf<LazyPromise<"value", { callback: null }>>();

  expectTypeOf(
    new LazyPromise<"value", { upstream: null }>(() => {}).inject(() => ({
      upstream: null,
    })),
  ).toEqualTypeOf<LazyPromise<"value", unknown>>();

  new LazyPromise<void, { upstream: null }>(() => {}).inject(
    /** @ts-expect-error */
    () => ({}),
  );
});

test("value of this", () => {
  const promise = box(1).inject(function () {
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

test("source promise resolves", () => {
  const promise = new LazyPromise<number, "upstream dep">((sink, dep) => {
    log("produce", dep);
    sink.resolve(1);
  }).inject((dep: "downstream dep") => {
    log("callback dep", dep);
    return "upstream dep" as const;
  });
  promise.subscribe(logConsumer, "downstream dep");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "callback dep",
        "downstream dep",
      ],
      [
        "produce",
        "upstream dep",
      ],
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("source promise rejects", () => {
  const promise = new LazyPromise<never, "upstream dep">((sink) => {
    sink.reject("oops");
  }).inject(() => "upstream dep" as const);
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

test("callback throws", () => {
  const promise = box(1).inject(() => {
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

test("cancel source promise", () => {
  const promise = new LazyPromise<never, "upstream dep">(() => () => {
    log("dispose");
  }).inject(() => "upstream dep" as const);
  const subscription = promise.subscribe();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  subscription.dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "dispose",
      ],
    ]
  `);
});
