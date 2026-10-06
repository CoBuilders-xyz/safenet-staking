/**
 * The process that owns Anvil. `fork:up` starts it detached, in its own session, with the
 * archive endpoint in its environment and nowhere else. It starts Anvil on a fork of Mainnet at
 * the settings' block, records both processes, passes a SIGTERM on, and exits when Anvil does.
 *
 * Anvil echoes the fork endpoint, and that URL carries a key. So every line Anvil prints passes
 * through redact() before it reaches this process's stdout, which `fork:up` points at
 * .fork-env/anvil.log. Anvil 1.8.4 takes the endpoint on its command line only, so a process
 * listing still shows it: list by port, never by command line.
 */
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { ANVIL_RECORD, readRecord, redact, removeRecord, self, writeRecord, type AnvilRecord } from "./processes"
import { ANVIL_PORT, FORK_BLOCK, SEF_SOURCE, TEST_AMOUNT, TEST_BALANCE } from "./settings"

const stamp = () => new Date().toISOString()

const forkUrl = process.env.MAINNET_RPC_URL
if (!forkUrl) {
  console.error(`${stamp()} MAINNET_RPC_URL is not in the environment. Start this through \`pnpm fork:up\`.`)
  process.exit(1)
}

console.log(`${stamp()} starting anvil on 127.0.0.1:${ANVIL_PORT}, a fork of Mainnet at block ${FORK_BLOCK}`)
const anvil = spawn(
  "anvil",
  [
    "--fork-url", forkUrl,
    "--fork-block-number", FORK_BLOCK.toString(),
    "--chain-id", "1",
    "--host", "127.0.0.1",
    "--port", String(ANVIL_PORT),
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
)
createInterface({ input: anvil.stdout }).on("line", (line) => console.log(redact(line)))
createInterface({ input: anvil.stderr }).on("line", (line) => console.error(redact(line)))

anvil.on("spawn", () => {
  const record: AnvilRecord = {
    launcher: self(process.pid),
    anvil: self(anvil.pid ?? 0),
    port: ANVIL_PORT,
    block: FORK_BLOCK.toString(),
    sefRef: SEF_SOURCE.ref,
    testAmount: TEST_AMOUNT.toString(),
    testBalance: TEST_BALANCE.toString(),
  }
  writeRecord(ANVIL_RECORD, record)
})
/** Forgets this Anvil, unless the record already names another launcher's. */
function forget(): void {
  if (readRecord<AnvilRecord>(ANVIL_RECORD)?.launcher.pid === process.pid) removeRecord(ANVIL_RECORD)
}
anvil.on("error", (err) => {
  console.error(`${stamp()} anvil could not start (${redact(err.message)}). Install Foundry.`)
  forget()
  process.exit(1)
})
anvil.on("exit", (code, signal) => {
  console.log(`${stamp()} anvil exited (${signal ?? code})`)
  forget()
  process.exit(code ?? (signal ? 1 : 0))
})
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => anvil.kill("SIGTERM"))
}
