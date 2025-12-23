import { afterEach, beforeEach, expect, test } from "@jest/globals";
import { pipe } from "pipe-function";
import { finalize } from "./finalize";
import { createLazyPromise, rejected, resolved } from "./lazyPromise";

const mockMicrotaskQueue: (() => void)[] = [];
const originalQueueMicrotask = queueMicrotask;
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

const processMockMicrotaskQueue = () => {
  while (mockMicrotaskQueue.length) {
    mockMicrotaskQueue.shift()!();
  }
};

beforeEach(() => {
  global.queueMicrotask = (task) => mockMicrotaskQueue.push(task);
});

afterEach(() => {
  processMockMicrotaskQueue();
  global.queueMicrotask = originalQueueMicrotask;
  try {
    if (logContents.length) {
      throw new Error("Log expected to be empty at the end of each test.");
    }
  } finally {
    logContents.length = 0;
  }
});

test("source resolves", () => {
  const promise = pipe(
    resolved(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe((value) => {
    log("handleValue", value);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleValue",
        1,
      ],
    ]
  `);
});

test("source rejects", () => {
  const promise = pipe(
    rejected(1),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, (error) => {
    log("handleError", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleError",
        1,
      ],
    ]
  `);
});

test("source fails", () => {
  const promise = pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail("oops");
    }),
    finalize(() => {
      log("finalize");
    }),
  );
  promise.subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "finalize",
      ],
      [
        "handleFailure",
        "oops",
      ],
    ]
  `);
});

test("callback throws", () => {
  pipe(
    resolved(1),
    finalize(() => {
      throw "oops 1";
    }),
  ).subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 1",
      ],
    ]
  `);

  pipe(
    rejected(1),
    finalize(() => {
      throw "oops 2";
    }),
  ).subscribe(
    undefined,
    () => {},
    (error) => {
      log("handleFailure", error);
    },
  );
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);

  pipe(
    createLazyPromise((resolve, reject, fail) => {
      fail("oops 1");
    }),
    finalize(() => {
      throw "oops 2";
    }),
  ).subscribe(undefined, undefined, (error) => {
    log("handleFailure", error);
  });
  expect(readLog()).toMatchInlineSnapshot(`
    [
      [
        "handleFailure",
        "oops 2",
      ],
    ]
  `);
});

test("unsubscribe in the callback (source resolves)", () => {
  let resolve: (value: number) => void;
  const unsubscribe = pipe(
    createLazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(() => {
    log("handleValue");
  });
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source rejects)", () => {
  let reject: (value: number) => void;
  const unsubscribe = pipe(
    createLazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
  );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe in the callback (source fails)", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = pipe(
    createLazyPromise<never, number>((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    finalize(() => {
      unsubscribe();
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
    () => {
      log("handleFailure");
    },
  );
  fail!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
});

test("unsubscribe and throw in the callback (source resolves)", () => {
  let resolve: (value: number) => void;
  const unsubscribe = pipe(
    createLazyPromise((resolveLocal) => {
      resolve = resolveLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    undefined,
    () => {
      log("handleFailure");
    },
  );
  resolve!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unsubscribe and throw in the callback (source rejects)", () => {
  let reject: (error: number) => void;
  const unsubscribe = pipe(
    createLazyPromise<never, number>((resolve, rejectLocal) => {
      reject = rejectLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
    () => {
      log("handleFailure");
    },
  );
  reject!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});

test("unsubscribe and throw in the callback (source fails)", () => {
  let fail: (error: unknown) => void;
  const unsubscribe = pipe(
    createLazyPromise((resolve, reject, failLocal) => {
      fail = failLocal;
    }),
    finalize(() => {
      unsubscribe();
      throw "oops";
    }),
  ).subscribe(
    () => {
      log("handleValue");
    },
    () => {
      log("handleError");
    },
    () => {
      log("handleFailure");
    },
  );
  fail!(1);
  expect(readLog()).toMatchInlineSnapshot(`[]`);
  expect(processMockMicrotaskQueue).toThrow("oops");
});
