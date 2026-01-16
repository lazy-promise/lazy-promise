import { nextTick } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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
  vi.useFakeTimers();
  vi.spyOn(process, "nextTick").mockImplementation((callback, ...args) => {
    setTimeout(() => callback(...args));
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
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
  vi.runAllTimers();
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
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
