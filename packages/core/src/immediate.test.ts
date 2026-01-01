import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { immediate } from "./immediate";

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
  jest
    .spyOn(global, "setImmediate")
    .mockImplementation(
      (callback, ...args) =>
        setTimeout(callback, 0, ...args) as unknown as NodeJS.Immediate,
    );
  jest.spyOn(global, "clearImmediate").mockImplementation((id) => {
    clearTimeout(id as unknown as NodeJS.Timeout);
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
  immediate().subscribe((value) => {
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
  immediate().subscribe(() => {
    log("handleValue");
  })();
  jest.runAllTimers();
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});
