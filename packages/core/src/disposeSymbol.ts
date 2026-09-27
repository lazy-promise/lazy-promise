// The fallback keeps the property key from being `undefined` in runtimes
// without explicit resource management. Which branch runs depends on the Node
// version (`Symbol.dispose` is native from Node 24), so this module is excluded
// from coverage in vitest.config.mjs.
export const disposeSymbol: typeof Symbol.dispose =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  Symbol.dispose ?? (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);
