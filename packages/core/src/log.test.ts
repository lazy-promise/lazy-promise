/* eslint-disable no-console */

import type { Consumer } from "@lazy-promise/core";
import { box, LazyPromise, log, rejecting } from "@lazy-promise/core";
import { afterEach, expect, test, vi } from "vitest";

const logContents: unknown[] = [];

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

const logConsumer: Consumer<any> = {
  resolve: (value) => {
    console.log("handleValue", value);
  },
  reject: (error) => {
    console.log("handleError", error);
  },
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

  new LazyPromise<number, "dep">((sink, dep) => {
    console.log("subscribing", dep);
    sink.resolve(1);
  })
    .pipe(log("base case"))
    .subscribe(logConsumer, "dep");
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[base case] [1] [subscribe] dep",
      "· subscribing dep",
      "· [base case] [1] [resolve] 1",
      "· · handleValue 1",
    ]
  `);
});

test("rejection", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  rejecting(1).pipe(log("rejection case")).subscribe(logConsumer);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[rejection case] [1] [subscribe] undefined",
      "· [rejection case] [1] [reject] 1",
      "· · handleError 1",
    ]
  `);
});

test("unsubscribe", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  new LazyPromise<never>(() => () => {
    console.log("unsubscribing");
  })
    .pipe(log("unsubscribe case"))
    .subscribe()
    .dispose();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[unsubscribe case] [1] [subscribe] undefined",
      "[unsubscribe case] [1] [unsubscribe]",
      "· unsubscribing",
    ]
  `);
});

test("unsubscribe (no teardown function)", () => {
  vi.spyOn(console, "log").mockImplementation((...args) =>
    logContents.push(args.map(String).join(" ")),
  );

  new LazyPromise<never>(() => {
    console.log("subscribing");
  })
    .pipe(log("unsubscribe (no teardown function) case"))
    .subscribe();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[unsubscribe (no teardown function) case] [1] [subscribe] undefined",
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
      "[counter case] [1] [subscribe] undefined",
      "· [counter case] [1] [resolve] 1",
      "[counter case] [2] [subscribe] undefined",
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
      "[1] [subscribe] undefined",
      "· [1] [resolve] 1",
      "[2] [subscribe] undefined",
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
      "[42] [1] [subscribe] undefined",
      "· [42] [1] [resolve] 1",
      "[42] [2] [subscribe] undefined",
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
    .subscribe({
      resolve: () => {
        console.log("a", "b");
        console.log(1, "a");
        console.log();
      },
    });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[label] [1] [subscribe] undefined",
      "· [label] [1] [resolve] undefined",
      "· · a b",
      "· · 1 a",
      "· ·",
    ]
  `);
});

/* eslint-enable no-console */
