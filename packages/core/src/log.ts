import { LazyPromise } from "./lazyPromise";

const instanceCountMap = new Map<string | number | undefined, number>();

const wrapLog =
  (fn: typeof console.log): typeof console.log =>
  (...args) => {
    if (typeof args[0] === "string") {
      fn("\u00B7 " + args[0], ...args.slice(1));
      return;
    }
    fn("\u00B7", ...args);
  };

const bumpStackLevel = <T>(callback: () => T) => {
  /* eslint-disable no-console */

  const previousLog = console.log;
  console.log = wrapLog(console.log);

  try {
    return callback();
  } finally {
    console.log = previousLog;
  }

  /* eslint-enable no-console */
};

/**
 * Wraps a lazy promise without changing its behavior, and console.logs
 * everything that happens to it.
 *
 * ```
 * lazyPromise.pipe(log("optional label"))
 * ```
 *
 * Each log record includes the label and a 1-based index that lets you tell
 * apart multiple promises that have the same label.
 *
 * While running callbacks, patches `console.log` so that the arguments are
 * prefixed with dots indicating sync stack depth, so
 *
 * ```
 * box(1).pipe(
 *   log("a"),
 *   map(() => {
 *     console.log("mapping");
 *   }),
 * ).subscribe();
 * ```
 *
 * will log
 *
 * ```
 * [a] [1] [subscribe]
 * · [a] [1] [resolve] 1
 * · · mapping
 * ```
 */
export const log =
  (label?: string | number) =>
  <Value, Error>(
    lazyPromise: LazyPromise<Value, Error>,
  ): LazyPromise<Value, Error> => {
    /* eslint-disable no-console */

    const counter = instanceCountMap.get(label) ?? 0;
    const id = counter + 1;
    instanceCountMap.set(label, id);
    const prefix = [...(label === undefined ? [] : [`[${label}]`]), `[${id}]`];
    return new LazyPromise((resolve, reject, fail) => {
      console.log(...prefix, `[subscribe]`);
      const unsubscribe = bumpStackLevel(() =>
        lazyPromise.subscribe(
          (value) => {
            console.log(...prefix, `[resolve]`, value);
            bumpStackLevel(() => {
              resolve(value);
            });
          },
          (error) => {
            console.log(...prefix, `[reject]`, error);
            bumpStackLevel(() => {
              reject(error);
            });
          },
          (error) => {
            console.log(...prefix, `[fail]`, error);
            bumpStackLevel(() => {
              fail(error);
            });
          },
        ),
      );
      if (unsubscribe) {
        return () => {
          console.log(...prefix, `[unsubscribe]`);
          bumpStackLevel(() => {
            unsubscribe();
          });
        };
      }
    });

    /* eslint-enable no-console */
  };
