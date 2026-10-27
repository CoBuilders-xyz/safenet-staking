/**
 * The entry of the standalone binary, `scripts/build-binary.mjs`. Node runs a single executable
 * application's script as CommonJS, which has no top-level await, so this entry waits on the
 * promise instead of awaiting it as `src/index.ts` does. In the binary, argv[0] and argv[1] are
 * both the executable, so the arguments start at index 2 as they do under `node`.
 */
import { processRuntime, run } from "./cli.js"

void run(process.argv.slice(2), processRuntime()).then((code) => {
  process.exitCode = code
})
