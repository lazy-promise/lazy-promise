import type { Subscriber } from "@lazy-promise/core";
import { inAnimationFrame } from "@lazy-promise/core";
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

const logSubscriber: Subscriber<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  global.requestAnimationFrame = (callback) =>
    setTimeout(() => {
      callback(42);
    }) as unknown as number;
  global.cancelAnimationFrame = (id) => {
    clearTimeout(id as unknown as NodeJS.Timeout);
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (global as any).requestAnimationFrame;
  delete (global as any).cancelAnimationFrame;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("resolve", () => {
  inAnimationFrame().subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleValue",
        42,
      ],
    ]
  `);
});

test("cancel", () => {
  inAnimationFrame().subscribe(logSubscriber).unsubscribe();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
