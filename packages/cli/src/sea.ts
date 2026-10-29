/**
 * The entry of the standalone binary, `scripts/build-binary.mjs`. Node runs a single executable
 * application's script as CommonJS, which has no top-level await, so this entry waits on the
 * promise instead of awaiting it as `src/index.ts` does. In the binary, argv[0] and argv[1] are
 * both the executable, so the arguments start at index 2 as they do under `node`.
 */
import { processRuntime, run } from "./cli.js"

void run(process.argv.slice(2), processRuntime()).then(async (code) => {
  // Keep the same shutdown contract as index.ts: wallet timers must not keep the CLI alive,
  // but piped JSON and transaction hashes must finish writing before it exits.
  await Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => {
    stream.write("", () => resolve())
  })))
  process.exit(code)
})
