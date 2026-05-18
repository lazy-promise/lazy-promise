import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { computed, effect, flush, signal, trigger } from "./index.js";

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

test("auto-flushes in a microtask when flush is not called", async () => {
  const a = signal(0);
  const doubled = computed(() => a() * 2);

  effect(() => {
    log("effect", doubled());
  });

  readLog(); // discard initial run

  a(1);
  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      0,
      0,
    ]
  `);

  await Promise.resolve();

  expect([a(), doubled()]).toMatchInlineSnapshot(`
    [
      1,
      2,
    ]
  `);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        2,
      ],
    ]
  `);
});

test("multiple writes before the microtask fires are batched into one flush", async () => {
  const a = signal(0);
  let runs = 0;

  effect(() => {
    runs++;
    a();
  });

  runs = 0;
  a(1);
  a(2);
  a(3);
  expect(a()).toBe(0);

  await Promise.resolve();

  expect(a()).toBe(3);
  expect(runs).toBe(1);
});

test("trigger defers effect re-run until auto-flush", async () => {
  const a = signal(0);

  effect(() => {
    log("effect", a());
  });

  readLog(); // discard initial run

  trigger(() => {
    a();
  });

  // effect has not re-run yet — deferred
  expect(readLog()).toMatchInlineSnapshot(`[]`);

  await Promise.resolve();

  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "effect",
        0,
      ],
    ]
  `);
});

test("writes inside auto-flush are processed in the same microtask", async () => {
  const a = signal(0);
  const b = signal(0);

  effect(() => {
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    log("b", b());
  });

  readLog(); // discard initial runs

  a(1);
  await Promise.resolve();

  expect(b()).toBe(1);
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "b",
        1,
      ],
    ]
  `);
});

test("signal written inside effect during flush can be written again afterwards", async () => {
  const a = signal(0);
  const b = signal(0);
  let bRuns = 0;

  effect(() => {
    if (a() === 1) {
      b(1);
    }
  });

  effect(() => {
    bRuns++;
    b();
  });

  bRuns = 0;

  a(1);
  await Promise.resolve();

  expect(b()).toBe(1);
  expect(bRuns).toBe(1);

  // b was written inside an effect during the first flush; make sure it can still be
  // written and observed normally in subsequent flushes.
  bRuns = 0;
  b(2);
  await Promise.resolve();

  expect(b()).toBe(2);
  expect(bRuns).toBe(1);
});
