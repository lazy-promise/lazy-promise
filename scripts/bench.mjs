// Micro-benchmarks for @lazy-promise/core no-tracing paths, comparing the
// working tree against a git ref (default: HEAD). Each variant runs in fresh
// processes and the minimum time per benchmark is reported, because JIT
// decisions vary between processes.
//
//   node scripts/bench.mjs [ref] [--runs=5]
//
// E.g.
//
//   node scripts/bench.mjs
//
// or
//
//   node scripts/bench.mjs @lazy-promise/core@0.0.38 --runs=2
//
// Builds the working tree with `turbo build:force` first.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const corePackage = join(repoRoot, "packages", "core");

const benchmarks = {
  "sync resolve": ({ LazyPromise }) => {
    const promise = new LazyPromise((sink) => {
      sink.resolve(1);
    });
    return () => {
      promise.subscribe(consumer);
    };
  },
  "sync reject": ({ LazyPromise }) => {
    const promise = new LazyPromise((sink) => {
      sink.reject(1);
    });
    return () => {
      promise.subscribe(consumer);
    };
  },
  "map chain": ({ box }) => {
    const promise = box(1)
      .map((value) => value + 1)
      .map((value) => value + 1)
      .map((value) => value + 1);
    return () => {
      promise.subscribe(consumer);
    };
  },
  flatten: ({ box }) => {
    const promise = box(1)
      .map(() => box(2))
      .map(() => box(3));
    return () => {
      promise.subscribe(consumer);
    };
  },
  "subscribe+dispose": ({ LazyPromise }) => {
    const promise = new LazyPromise(() => () => {});
    return () => {
      promise.subscribe(consumer).dispose();
    };
  },
};

const consumer = { resolve() {}, reject() {} };

const iterations = 3_000_000;
const warmupIterations = 300_000;
const roundsPerProcess = 7;

// Worker mode: `node scripts/bench.mjs --worker <index.js path>`.
const runWorker = async (modulePath) => {
  const core = await import(modulePath);
  for (const [name, setup] of Object.entries(benchmarks)) {
    const fn = setup(core);
    for (let i = 0; i < warmupIterations; i++) {
      fn();
    }
    let best = Infinity;
    for (let round = 0; round < roundsPerProcess; round++) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < iterations; i++) {
        fn();
      }
      best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
    }
    console.log(`${name}\t${best.toFixed(0)}`);
  }
};

const buildRef = (ref, outDir) => {
  const srcRoot = join(outDir, "src");
  execFileSync(
    "sh",
    [
      "-c",
      `mkdir -p "${srcRoot}" && git archive "${ref}" packages/core/src | tar -x -C "${srcRoot}"`,
    ],
    { cwd: repoRoot, stdio: "inherit" },
  );
  const entry = join(srcRoot, "packages", "core", "src", "index.ts");
  const built = join(outDir, "build");
  // Run from the core package so that @types resolve the same way.
  execFileSync(
    "npx",
    [
      "tsc",
      "--module",
      "preserve",
      "--target",
      "es2022",
      "--lib",
      "es2022",
      "--moduleDetection",
      "force",
      "--skipLibCheck",
      "--strict",
      "--stripInternal",
      "--declaration",
      "false",
      "--rootDir",
      dirname(entry),
      "--outDir",
      built,
      entry,
    ],
    { cwd: corePackage, stdio: "inherit" },
  );
  return join(built, "index.js");
};

const buildWorkingTree = () => {
  execFileSync("npx", ["turbo", "build:force", "--filter=@lazy-promise/core"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  return join(corePackage, "build", "module", "index.js");
};

const compare = (ref, runs) => {
  const tempDir = mkdtempSync(join(tmpdir(), "lazy-promise-bench-"));
  try {
    const variants = {
      "working tree": buildWorkingTree(),
      [ref]: buildRef(ref, tempDir),
    };
    const results = {};
    for (let run = 0; run < runs; run++) {
      for (const [variant, modulePath] of Object.entries(variants)) {
        const output = execFileSync(
          process.execPath,
          [
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            fileURLToPath(import.meta.url),
            "--worker",
            modulePath,
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
        );
        for (const line of output.trim().split("\n")) {
          const [name, ms] = line.split("\t");
          const row = (results[name] ??= {});
          row[variant] = Math.min(row[variant] ?? Infinity, Number(ms));
        }
      }
    }
    console.log(
      `ms per ${iterations.toLocaleString()} iterations, min of ${runs} processes:`,
    );
    console.table(results);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
};

const args = process.argv.slice(2);
if (args[0] === "--worker") {
  await runWorker(args[1]);
} else {
  const runsArg = args.find((arg) => arg.startsWith("--runs="));
  const ref = args.find((arg) => !arg.startsWith("--")) ?? "HEAD";
  compare(ref, runsArg ? Number(runsArg.slice("--runs=".length)) : 5);
}
