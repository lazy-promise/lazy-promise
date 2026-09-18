/**
 * Captures the async context at construction; `runInAsyncScope` restores it.
 */
export interface AsyncContextResource {
  runInAsyncScope<This, Args extends unknown[]>(
    fn: (this: This, ...args: Args) => void,
    thisArg: This,
    ...args: Args
  ): void;
}

interface NodeLikeProcess {
  versions?: { node?: string };
  getBuiltinModule?: (
    id: string,
  ) =>
    { AsyncResource?: new (type: string) => AsyncContextResource } | undefined;
}

const getAsyncResource = () => {
  const nodeProcess = (globalThis as { process?: NodeLikeProcess }).process;
  // `versions.node` tells a Node-like runtime apart from browser shims.
  if (!nodeProcess?.versions?.node) {
    return undefined;
  }
  if (typeof nodeProcess.getBuiltinModule !== "function") {
    throw new Error(
      "LazyPromise needs process.getBuiltinModule to propagate AsyncLocalStorage context. Upgrade to Node.js 20.16+ / 22.3+ (or an equivalent runtime).",
    );
  }
  return nodeProcess.getBuiltinModule("node:async_hooks")?.AsyncResource;
};

/**
 * `AsyncResource` when the runtime provides it, `undefined` in browsers. Much
 * cheaper to create than `AsyncLocalStorage.snapshot()`.
 */
export const AsyncResource = getAsyncResource();
