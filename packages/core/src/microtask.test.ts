import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { microtask } from "./microtask";

const logContents: unknown[] = [];

const log = (...args: unknown[]) => {
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
  jest.spyOn(global, "queueMicrotask").mockImplementation((callback) => {
    setTimeout(callback);
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("resolve", () => {
  microtask().subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("cancel", () => {
  microtask().subscribe(() => {
    log("handleValue");
  })();
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
