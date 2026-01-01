import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { idleCallback } from "./idleCallback";

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
  jest.useRealTimers();
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
  idleCallback({ timeout: 42 }).subscribe((value) => {
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
  jest.runAllTimers();
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
  idleCallback().subscribe(() => {
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
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
