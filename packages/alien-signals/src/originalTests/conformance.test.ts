import type { ReactiveFramework } from "reactive-framework-test-suite";
import { SkipTest, setExpect, testSuite } from "reactive-framework-test-suite";
import { describe, expect, test } from "vitest";
import { computed, effect, effectScope, setActiveSub, signal } from "..";

// The suite expects writes to propagate synchronously, while the library only
// flushes in a microtask it schedules via queueMicrotask. Capture the
// scheduled auto-flush and run it synchronously after each write.
let pendingAutoFlush: (() => void) | undefined;

const drainAutoFlush = () => {
  while (pendingAutoFlush !== undefined) {
    const callback = pendingAutoFlush;
    pendingAutoFlush = undefined;
    callback();
  }
};

const framework: ReactiveFramework = {
  signal(initialValue) {
    const s = signal(initialValue);
    return {
      read: () => s(),
      write: (v) => {
        const originalQueueMicrotask = globalThis.queueMicrotask;
        globalThis.queueMicrotask = (callback) => {
          pendingAutoFlush = callback;
        };
        try {
          s(v);
          drainAutoFlush();
        } finally {
          globalThis.queueMicrotask = originalQueueMicrotask;
        }
      },
    };
  },
  computed(fn) {
    const c = computed(fn);
    return { read: () => c() };
  },
  effect(fn) {
    return effect(fn);
  },
  run(fn) {
    effectScope(fn)();
  },
  untracked(fn) {
    const prev = setActiveSub(undefined);
    try {
      return fn();
    } finally {
      setActiveSub(prev);
    }
  },
};

setExpect(expect);

for (const { section, cases } of testSuite) {
  describe(section, () => {
    for (const [name, fn] of Object.entries(cases)) {
      test(name, () => {
        try {
          framework.run(() => fn(framework));
        } catch (e) {
          if (e instanceof SkipTest) {
            return;
          }
          throw e;
        }
      });
    }
  });
}
