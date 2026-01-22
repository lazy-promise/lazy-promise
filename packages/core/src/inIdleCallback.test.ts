import { inIdleCallback } from "@lazy-promise/core";
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
  global.requestIdleCallback = (callback, options) => {
    log("requestIdleCallback", options);
    return setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => 43,
      });
    }) as unknown as number;
  };
  global.cancelIdleCallback = (id) => {
    clearTimeout(id as unknown as NodeJS.Timeout);
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (global as any).requestIdleCallback;
  delete (global as any).cancelIdleCallback;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("resolve", () => {
  inIdleCallback({ timeout: 42 }).subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "requestIdleCallback",
        {
          "timeout": 42,
        },
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        {
          "didTimeout": false,
          "timeRemaining": [Function],
        },
      ],
    ]
  `);
});

test("cancel", () => {
  inIdleCallback().subscribe(() => {
    log("handleValue");
  })();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "requestIdleCallback",
        undefined,
      ],
    ]
  `);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
