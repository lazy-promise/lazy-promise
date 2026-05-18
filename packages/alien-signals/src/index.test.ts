import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { effect, signal } from "./index.js";

const logContents: unknown[] = [];
let logTime = 0;

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
  vi.useFakeTimers();
  logTime = Date.now();
});

afterEach(() => {
  vi.useRealTimers();
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("sample test - remove it and replace with others", () => {
  const a = signal(0);
  effect(() => {
    log(a());
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        0,
      ],
    ]
  `);
});
