import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { pipe } from "pipe-function";
import type { LazyPromise } from "./lazyPromise";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";
import { map } from "./map";

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

test("mapping", () => {
  const promise = pipe(
    resolved(1),
    map((value) => value + 1),
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

test("flat mapping", () => {
  const promise = pipe(
    createLazyPromise<number>((resolve) => {
      setTimeout(() => {
        resolve(1);
      }, 1000);
    }),
    map((value) =>
      createLazyPromise<number>((resolve) => {
        setTimeout(() => {
          resolve(value + 1);
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

test("outer promise rejects", () => {
  const promise = pipe(
    rejected("oops") as LazyPromise<number, string>,
    map((value) => value + 1),
  );
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
      ],
    ]
  `);
});

test("inner promise rejects", () => {
  const promise = pipe(
    resolved(1),
    map(() => rejected("oops")),
  );
  promise.subscribe(undefined, (error) => {
    log("reject", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "reject",
        "oops",
      ],
    ]
  `);
});

test("cancel outer promise", () => {
  const promise = pipe(
    createLazyPromise<number>((resolve) => {
      setTimeout(() => {
        resolve(1);
      }, 1000);
      return () => {
        log("dispose");
      };
    }),
    map((value) => value + 1),
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
    resolved(1),
    map((value) =>
      createLazyPromise<number>((resolve) => {
        setTimeout(() => {
          resolve(value + 1);
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
