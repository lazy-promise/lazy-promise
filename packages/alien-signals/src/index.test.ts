import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { computed, effect, flush, signal } from "./index.js";

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

test("signal writes stay stale until flush", () => {
  const a = signal(0);
  const doubled = computed(() => a() * 2);

  effect(() => {
    log("effect", doubled());
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
    ]
  `);

  a(1);
  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `);

  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        2,
      ],
    ]
  `);

  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      1,
      2,
    ]
  `);
});

test("multiple writes to the same signal coalesce to the last value", () => {
  const a = signal(0);
  a(1);
  a(2);
  a(3);
  expect(a()).toBe(0);
  flush();
  expect(a()).toBe(3);
});

test("flush drains chained writes", () => {
  const a = signal(0);
  const b = signal(0);

  effect(() => {
    log("first", a());
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    log("second", b());
  });

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "first",
        0,
      ],
      [
        "second",
        0,
      ],
    ]
  `);

  a(1);

  expect(readLog()).toMatchInlineSnapshot(`[]`);

  flush();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "first",
        1,
      ],
      [
        "second",
        1,
      ],
    ]
  `);
});
