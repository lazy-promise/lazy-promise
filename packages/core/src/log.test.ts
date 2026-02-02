/* eslint-disable no-console */

import { box, failed, LazyPromise, log, rejected } from "@lazy-promise/core";
import { afterEach, expect, test, vi } from "vitest";

const logContents: unknown[] = [];

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

afterEach(() => {
  vi.restoreAllMocks();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("base case", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  new LazyPromise((resolve) => {
    console.log("subscribing");
    resolve(1);
  })
    .pipe(log("base case"))
    .subscribe((value) => {
      console.log("handleValue", value);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[base case] [1] [subscribe]",
      "· subscribing",
      "· [base case] [1] [resolve] 1",
      "· · handleValue 1",
    ]
  `);
});

test("rejection", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  rejected(1)
    .pipe(log("rejection case"))
    .subscribe(undefined, (error) => {
      console.log("handleRejection", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[rejection case] [1] [subscribe]",
      "· [rejection case] [1] [reject] 1",
      "· · handleRejection 1",
    ]
  `);
});

test("failure", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  failed(1)
    .pipe(log("failure case"))
    .subscribe(undefined, undefined, (error) => {
      console.log("handleFailure", error);
    });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[failure case] [1] [subscribe]",
      "· [failure case] [1] [fail] 1",
      "· · handleFailure 1",
    ]
  `);
});

test("unsubscribe", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  new LazyPromise(() => () => {
    console.log("unsubscribing");
  })
    .pipe(log("unsubscribe case"))
    .subscribe()!();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[unsubscribe case] [1] [subscribe]",
      "[unsubscribe case] [1] [unsubscribe]",
      "· unsubscribing",
    ]
  `);
});

test("unsubscribe (no teardown function)", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  const unsubscribe = new LazyPromise(() => {
    console.log("subscribing");
  })
    .pipe(log("unsubscribe (no teardown function) case"))
    .subscribe();
  expect(unsubscribe).toMatchInlineSnapshot(`undefined`);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[unsubscribe (no teardown function) case] [1] [subscribe]",
      "· subscribing",
    ]
  `);
});

test("counter", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  const getPromise = () => box(1).pipe(log("counter case"));
  getPromise().subscribe();
  getPromise().subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[counter case] [1] [subscribe]",
      "· [counter case] [1] [resolve] 1",
      "[counter case] [2] [subscribe]",
      "· [counter case] [2] [resolve] 1",
    ]
  `);
});

test("no label", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  const getPromise = () => box(1).pipe(log());
  getPromise().subscribe();
  getPromise().subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[1] [subscribe]",
      "· [1] [resolve] 1",
      "[2] [subscribe]",
      "· [2] [resolve] 1",
    ]
    `);
});

test("number as label", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  const getPromise = () => box(1).pipe(log(42));
  getPromise().subscribe();
  getPromise().subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[42] [1] [subscribe]",
      "· [42] [1] [resolve] 1",
      "[42] [2] [subscribe]",
      "· [42] [2] [resolve] 1",
    ]
  `);
});

test("patched console.log", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  box()
    .pipe(log("label"))
    .subscribe(() => {
      console.log("a", "b");
      console.log(1, "a");
      console.log();
    });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[label] [1] [subscribe]",
      "· [label] [1] [resolve] undefined",
      "· · a b",
      "· · 1 a",
      "· ·",
    ]
  `);
});

/* eslint-enable no-console */
