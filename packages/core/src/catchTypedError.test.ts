import type { InnerSubscriber, Subscriber } from "@lazy-promise/core";
import {
  box,
  catchTypedError,
  LazyPromise,
  rejecting,
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
    new LazyPromise<"value a" | TypedError<"error a">>(() => {}).pipe(
      catchTypedError((error) => {
        expectTypeOf(error).toEqualTypeOf<"error a">();
        return "value b" as const;
      }),
    ),
  ).toEqualTypeOf<LazyPromise<"value a" | "value b">>();

  expectTypeOf(
    new LazyPromise<"value a" | TypedError<"error a">>(() => {}).pipe(
      catchTypedError(
        () => new LazyPromise<"value b" | TypedError<"error b">>(() => {}),
      ),
    ),
  ).toEqualTypeOf<LazyPromise<TypedError<"error b"> | "value a" | "value b">>();
});

test("value of this", () => {
  const promise = box(new TypedError("error")).pipe(
    catchTypedError(function () {
      /** @ts-expect-error */
      log("in callback", this);
    }),
  );
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
  const promise = box(new TypedError(1)).pipe(
    catchTypedError((error) => error + 1),
  );
  promise.subscribe(logSubscriber);
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
  const promise = box(1).pipe(catchTypedError(() => undefined));
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

test("outer promise rejects", () => {
  const promise = new LazyPromise((subscriber) => {
    subscriber.reject("oops");
  }).pipe(catchTypedError(() => undefined));
  promise.subscribe(logSubscriber);
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
  const promise = box(new TypedError("a")).pipe(
    catchTypedError(() => box("b")),
  );
  promise.subscribe(logSubscriber);
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
  const promise = box(new TypedError("a")).pipe(
    catchTypedError(() => rejecting("b")),
  );
  promise.subscribe(logSubscriber);
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
  const promise = box(new TypedError("a")).pipe(
    catchTypedError(() => {
      throw "oops";
    }),
  );
  promise.subscribe(logSubscriber);
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
  }).pipe(catchTypedError((value) => value + 1));
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
  const promise = box(new TypedError("a")).pipe(
    catchTypedError(
      () =>
        new LazyPromise<never>(() => () => {
          log("dispose");
        }),
    ),
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
  let subscriber: InnerSubscriber<TypedError<number>>;
  const subscription = new LazyPromise<TypedError<number>>(
    (subscriberLocal) => {
      subscriber = subscriberLocal;
    },
  )
    .pipe(
      catchTypedError(() => {
        subscription.unsubscribe();
      }),
    )
    .subscribe(logSubscriber);
  subscriber!.resolve(new TypedError(1));
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback", () => {
  let subscriber: InnerSubscriber<TypedError<number>>;
  const subscription = new LazyPromise<TypedError<number>>(
    (subscriberLocal) => {
      subscriber = subscriberLocal;
    },
  )
    .pipe(
      catchTypedError(() => {
        subscription.unsubscribe();
        throw "oops";
      }),
    )
    .subscribe(logSubscriber);
  subscriber!.resolve(new TypedError(1));
});
