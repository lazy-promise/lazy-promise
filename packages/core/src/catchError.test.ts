import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { catchError } from "./catchError";
import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

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

beforeEach(() => {
  jest.useFakeTimers();
  logTime = Date.now();
});

afterEach(() => {
  jest.useRealTimers();
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
    createLazyPromise<"value a", "error a">(() => {}),
    catchError(() => "value b" as const),
  );

  // $ExpectType LazyPromise<"value a" | "value b", "error b">
  const promise2 = pipe(
    createLazyPromise<"value a", "error a">(() => {}),
    catchError(() => createLazyPromise<"value b", "error b">(() => {})),
  );

  /* eslint-enable @typescript-eslint/no-unused-vars */
});

test("falling back to a value", () => {
  const promise = pipe(
    rejected(1),
    catchError((error) => error + 1),
  );
  promise.subscribe((value) => {
    log("resolve", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolve",
        2,
      ],
    ]
  `);
});

test("falling back to a promise", () => {
  const promise = pipe(
    createLazyPromise<never, number>((_, reject) => {
      setTimeout(() => {
        reject(1);
      }, 1000);
    }),
    catchError((error) =>
      createLazyPromise<number>((resolve) => {
        setTimeout(() => {
          resolve(error + 1);
        }, 1000);
      }),
    ),
  );
  promise.subscribe((value) => {
    log("resolve", value);
  });
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "2000 ms passed",
      [
        "resolve",
        2,
      ],
    ]
  `);
});

test("outer promise resolves", () => {
  const promise = pipe(
    resolved(1) as LazyPromise<number, number>,
    catchError(() => undefined),
  );
  promise.subscribe((value) => {
    log("resolved", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "resolved",
        1,
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = pipe(
    rejected("a"),
    catchError(() => rejected("b")),
  );
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "b",
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = pipe(
    createLazyPromise<never, number>((_, reject) => {
      setTimeout(() => {
        reject(1);
      }, 1000);
      return () => {
        log("dispose");
      };
    }),
    catchError((value) => value + 1),
  );
  const dispose = promise.subscribe();
  jest.advanceTimersByTime(500);
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
    catchError((error) =>
      createLazyPromise<number>((resolve) => {
        setTimeout(() => {
          resolve(error + 1);
        }, 1000);
        return () => {
          log("dispose");
        };
      }),
    ),
  );
  const dispose = promise.subscribe();
  jest.advanceTimersByTime(500);
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
