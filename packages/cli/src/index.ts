#!/usr/bin/env node
import { processRuntime, run } from "./cli.js"

const code = await run(process.argv.slice(2), processRuntime())
// WalletConnect can retain request-expiry timers after session teardown. The standalone CLI
// must return after cleanup, including cancellation. Flush both streams before exiting so
// piped JSON and transaction hashes are not truncated. Library callers keep their own lifecycle.
await Promise.all([process.stdout, process.stderr].map((stream) => new Promise<void>((resolve) => {
  stream.write("", () => resolve())
})))
process.exit(code)
