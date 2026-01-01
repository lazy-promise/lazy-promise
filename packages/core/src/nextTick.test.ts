import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { nextTick } from "./nextTick";

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
  jest.spyOn(process, "nextTick").mockImplementation((callback, ...args) => {
    setTimeout(() => callback(...args));
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
  nextTick().subscribe((value) => {
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
  nextTick().subscribe(() => {
    log("handleValue");
  })();
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
