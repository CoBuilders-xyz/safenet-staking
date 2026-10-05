/**
 * Starts Anvil on a fork of Mainnet at MAINNET_FORK.blockNumber, on ANVIL_PORT.
 *
 * Playwright runs this as a webServer of the fork suite (see ../playwright.config.ts), waits for
 * the port, and kills the whole process group when the run ends, pass or fail. So Anvil never
 * outlives a run, and a leftover one from a killed run makes the next run fail on the port
 * rather than test against stale state.
 *
 *   MAINNET_RPC_URL   archive endpoint to fork from. From the environment, or from .env.local
 *                     at the repository root through the package script's --env-file flag.
 *
 * Anvil echoes the fork URL, which carries a key. Every line it prints passes through redact().
 */
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { MAINNET_FORK } from "@cobuilders/safenet-core"
import { ANVIL_PORT } from "../ports"

const redact = (line: string) => line.replace(/https?:\/\/\S+/g, "<redacted-url>")

const forkUrl = process.env.MAINNET_RPC_URL
if (!forkUrl) {
  console.error(
    "anvil: MAINNET_RPC_URL is not set. The fork suite needs an archive endpoint: run `pnpm env:pull`, " +
      "or export it. Public endpoints are not a fallback, because they cannot serve state at a pinned block.",
  )
  process.exit(1)
}

const anvil = spawn(
  "anvil",
  [
    "--fork-url", forkUrl,
    "--fork-block-number", MAINNET_FORK.blockNumber.toString(),
    "--host", "127.0.0.1",
    "--port", ANVIL_PORT,
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
)

createInterface({ input: anvil.stdout }).on("line", (line) => console.log(redact(line)))
createInterface({ input: anvil.stderr }).on("line", (line) => console.error(redact(line)))

anvil.on("error", (err) => {
  console.error(`anvil: could not start (${redact(err.message)}). Install Foundry: https://getfoundry.sh`)
  process.exit(1)
})
anvil.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)))

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => anvil.kill(signal))
}
