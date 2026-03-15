import type { Subscriber } from "@lazy-promise/core";
import { inScheduled } from "@lazy-promise/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const logContents: unknown[] = [];
let logTime: number;

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

const logSubscriber: Subscriber<any> = {
  resolve: (value) => {
    log("handleValue", value);
  },
  reject: (error) => {
    log("handleError", error);
  },
};

const priorityToDelay: Record<TaskPriority, number> = {
  "user-blocking": 0,
  "user-visible": 100,
  background: 200,
};

const mockScheduler: Scheduler = {
  postTask: (
    callback: () => any,
    options?: { priority?: TaskPriority; delay?: number; signal?: AbortSignal },
  ) =>
    new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal && signal.constructor !== AbortSignal) {
        throw new Error("Support for TaskSignal not implemented");
      }
      signal?.throwIfAborted();

      const timeoutId = setTimeout(
        async () => {
          try {
            const result = await callback();
            resolve(result);
          } catch (error) {
            reject(error);
          } finally {
            // eslint-disable-next-line no-use-before-define
            signal?.removeEventListener("abort", handleAbort);
          }
        },
        priorityToDelay[options?.priority ?? "user-visible"],
      );

      const handleAbort = () => {
        clearTimeout(timeoutId);
        reject(new DOMException("The operation was aborted", "AbortError"));
      };

      signal?.addEventListener("abort", handleAbort, { once: true });
    }),
  yield: () => {
    throw new Error("Not implemented");
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  logTime = Date.now();
  vi.stubGlobal("scheduler", mockScheduler);
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
  vi.unstubAllGlobals();
});

test("resolve", () => {
  inScheduled().subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "100 ms passed",
      [
        "handleValue",
        undefined,
      ],
    ]
  `);

  inScheduled({ priority: "background" }).subscribe(logSubscriber);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`
    [
      "200 ms passed",
      [
        "handleValue",
        undefined,
      ],
    ]
  `);
});

test("cancel", () => {
  inScheduled().subscribe(logSubscriber).unsubscribe();
  vi.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
