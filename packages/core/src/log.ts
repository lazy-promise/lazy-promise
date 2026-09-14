import type { LazyPromise } from "./lazyPromise.js";
import type { Span, Tracer } from "./trace.js";
import { throwInMicrotask } from "./utils.js";

const instanceCountMap = new Map<string | number | undefined, number>();

const labelMap = new WeakMap<
  LazyPromise<any, any>,
  string | number | undefined
>();

const formatNewLabel = (label: string | number | undefined) =>
  label === undefined ? "no label" : "label " + JSON.stringify(label);

const formatOldLabel = (
  oldLabel: string | number | undefined,
  newLabel: string | number | undefined,
) =>
  oldLabel === newLabel
    ? oldLabel === undefined
      ? "also no label"
      : "same label"
    : oldLabel === undefined
      ? "no label"
      : "label " + JSON.stringify(oldLabel);

const wrapLog =
  (fn: typeof console.log): typeof console.log =>
  (...args) => {
    if (typeof args[0] === "string") {
      fn("\u00B7 " + args[0], ...args.slice(1));
      return;
    }
    fn("\u00B7", ...args);
  };

/* eslint-disable no-console */

class LogTracer implements Tracer<any, any>, Span<any> {
  constructor(public prefix: string[]) {}

  subscribe(dep: unknown) {
    console.log(...this.prefix, `[subscribe]`, dep);
    return this;
  }

  run(work: () => void) {
    const previousLog = console.log;
    console.log = wrapLog(previousLog);
    try {
      work();
    } finally {
      console.log = previousLog;
    }
  }

  resolve(value: unknown) {
    console.log(...this.prefix, `[resolve]`, value);
  }

  reject(error: unknown) {
    console.log(...this.prefix, `[reject]`, error);
  }

  flatten() {
    console.log(...this.prefix, `[flatten]`);
  }

  unsubscribe() {
    console.log(...this.prefix, `[unsubscribe]`);
  }
}

/* eslint-enable no-console */

/**
 * Passes a LazyPromise through without changing its identity but adds logging
 * of everything that happens to it.
 *
 * ```
 * lazyPromise.pipe(log("optional label"))
 * ```
 *
 * While running callbacks, patches `console.log` so that the arguments are
 * prefixed with dots indicating causality, so
 *
 * ```
 * box(1)
 *   .pipe(log("a"))
 *   .map(() => {
 *     console.log("mapping");
 *   })
 *   .subscribe();
 * ```
 *
 * will log
 *
 * ```
 * [a] [1] [subscribe] undefined
 * · [a] [1] [resolve] 1
 * · · mapping
 * ```
 *
 * Dots reset whenever an async boundary is crossed. The number in the second
 * pair of brackets tells apart entries that share a label. The value logged
 * after `[subscribe]` is the dependency.
 */
export const log =
  (label?: string | number) =>
  <Value, Dep>(
    lazyPromise: LazyPromise<Value, Dep>,
  ): LazyPromise<Value, Dep> => {
    if (labelMap.has(lazyPromise)) {
      throwInMicrotask(
        new Error(
          `The log(...) call (${formatNewLabel(label)}) was ignored because the LazyPromise is already being logged (${formatOldLabel(labelMap.get(lazyPromise), label)}).`,
        ),
      );
      return lazyPromise;
    }
    labelMap.set(lazyPromise, label);
    const id = (instanceCountMap.get(label) ?? 0) + 1;
    instanceCountMap.set(label, id);
    lazyPromise.trace(
      new LogTracer([
        ...(label === undefined ? [] : [`[${label}]`]),
        `[${id}]`,
      ]),
    );
    return lazyPromise;
  };
