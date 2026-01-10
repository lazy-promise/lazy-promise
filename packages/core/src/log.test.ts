/* eslint-disable no-console */

import { afterEach, expect, jest, test } from "@jest/globals";
import { createLazyPromise, failed, rejected, resolved } from "./lazyPromise";
import { log } from "./log";
import { pipe } from "./pipe";

const logContents: unknown[] = [];

const readLog = () => {
  try {
    return [...logContents];
  } finally {
    logContents.length = 0;
  }
};

afterEach(() => {
  jest.restoreAllMocks();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("base case", () => {
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  pipe(
    createLazyPromise((resolve) => {
      console.log("subscribing");
      resolve(1);
    }),
    log("base case"),
  ).subscribe((value) => {
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
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  pipe(rejected(1), log("rejection case")).subscribe(undefined, (error) => {
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
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  pipe(failed(1), log("failure case")).subscribe(
    undefined,
    undefined,
    (error) => {
      console.log("handleFailure", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[failure case] [1] [subscribe]",
      "· [failure case] [1] [fail] 1",
      "· · handleFailure 1",
    ]
  `);
});

test("unsubscribe", () => {
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  pipe(
    createLazyPromise(() => () => {
      console.log("unsubscribing");
    }),
    log("unsubscribe case"),
  ).subscribe()();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "[unsubscribe case] [1] [subscribe]",
      "[unsubscribe case] [1] [unsubscribe]",
      "· unsubscribing",
    ]
  `);
});

test("counter", () => {
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  const getPromise = () => pipe(resolved(1), log("counter case"));
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
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  const getPromise = () => pipe(resolved(1), log());
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
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  const getPromise = () => pipe(resolved(1), log(42));
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
  jest
    .spyOn(console, "log")
    .mockImplementation((...args) =>
      logContents.push(args.map(String).join(" ")),
    );

  pipe(resolved(), log("label")).subscribe(() => {
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
