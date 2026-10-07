/**
 * Starts, checks and stops the Anvil this tool owns.
 *
 * An Anvil is "ours" when .fork-env/anvil.json names it and the processes in it still run with
 * the start times recorded: the launcher, or Anvil itself. Anything else on the port belongs to
 * someone else and is never touched; `fork:up` fails and says so.
 */
import {
  ANVIL_LOG, ANVIL_RECORD, SETUP_RECORD, alive, owned, portInUse, readRecord, removeRecord, rpc, sleep, startDetached,
  terminate, waitFor, type AnvilRecord, type Owned, type SetupRecord,
} from "./processes"
import {
  ANVIL_PORT, ANVIL_URL, FORK_BLOCK, FORK_CHAIN_ID_HEX, SEF_SOURCE, TEST_AMOUNT, TEST_BALANCE, archiveUrl, childEnvironment,
} from "./settings"

export const anvilAnswers = async (): Promise<boolean> => (await rpc(ANVIL_URL, "eth_chainId")) === FORK_CHAIN_ID_HEX

/** Why `fork:up` stops when the settings' port is held by a process this tool did not start. */
export const foreignPort = (): Error =>
  new Error(`Port ${ANVIL_PORT} is in use, and not by an Anvil this tool started. Stop it, or set QA_ANVIL_PORT.`)

/** The processes of this tool's Anvil that still run. Empty when there is no such Anvil. */
function ownProcesses(record: AnvilRecord | undefined): Owned[] {
  if (!record) return []
  return [record.launcher, record.anvil].filter(owned)
}

function asWanted(r: Pick<AnvilRecord, "port" | "block" | "sefRef" | "testAmount" | "testBalance">): boolean {
  return (
    r.port === ANVIL_PORT &&
    r.block === FORK_BLOCK.toString() &&
    r.sefRef === SEF_SOURCE.ref &&
    r.testAmount === TEST_AMOUNT.toString() &&
    r.testBalance === TEST_BALANCE.toString()
  )
}

export type AnvilStatus =
  | { state: "ready"; setup: SetupRecord }
  | { state: "stale"; why: string }
  | { state: "absent" }
  | { state: "foreign" }

export async function anvilStatus(): Promise<AnvilStatus> {
  const record = readRecord<AnvilRecord>(ANVIL_RECORD)
  if (ownProcesses(record).length === 0) {
    removeRecord(ANVIL_RECORD)
    removeRecord(SETUP_RECORD)
    return (await portInUse(ANVIL_PORT)) ? { state: "foreign" } : { state: "absent" }
  }
  if (!record || !asWanted(record)) {
    // Ours runs on another port, and something else holds the one the settings name. Restarting
    // would stop ours and still find the port taken, so leave both alone.
    if (record && record.port !== ANVIL_PORT && (await portInUse(ANVIL_PORT))) return { state: "foreign" }
    return { state: "stale", why: "its block, port, data source or amounts differ from the settings" }
  }
  if (!(await anvilAnswers())) return { state: "stale", why: "it does not answer" }
  const setup = readRecord<SetupRecord>(SETUP_RECORD)
  if (!setup || !asWanted({ port: ANVIL_PORT, ...setup })) return { state: "stale", why: "its setup did not complete" }
  return { state: "ready", setup }
}

/**
 * Starts Anvil detached and resolves once the record names this launch's launcher and Anvil,
 * both still running, and Anvil answers. Refuses when the port is taken: whatever answers there
 * is not this tool's. Fails, with the log named, when Anvil does not come up or the launcher
 * exits first.
 */
export async function startAnvil(): Promise<void> {
  if (await portInUse(ANVIL_PORT)) throw foreignPort()
  removeRecord(ANVIL_RECORD)
  removeRecord(SETUP_RECORD)
  const env = { ...childEnvironment(), MAINNET_RPC_URL: archiveUrl() }
  const launcherPid = startDetached("anvil-launcher.ts", ANVIL_LOG, env)
  const ours = (r: AnvilRecord | undefined): r is AnvilRecord =>
    r?.launcher.pid === launcherPid && r.port === ANVIL_PORT && owned(r.launcher) && owned(r.anvil)
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const record = readRecord<AnvilRecord>(ANVIL_RECORD)
    // Checked again after the answer: an Anvil that failed to bind exits, and what answered
    // was then someone else's.
    if (ours(record) && (await anvilAnswers()) && ours(readRecord<AnvilRecord>(ANVIL_RECORD))) return
    if (!alive(launcherPid)) break
    await sleep(500)
  }
  await stopAnvil()
  throw new Error(`Anvil did not come up on ${ANVIL_URL}. See ${ANVIL_LOG}.`)
}

/** Stops this tool's Anvil, if any, and forgets it. Answers whether there was one. */
export async function stopAnvil(): Promise<boolean> {
  const record = readRecord<AnvilRecord>(ANVIL_RECORD)
  const processes = ownProcesses(record)
  for (const o of processes) await terminate(o)
  removeRecord(ANVIL_RECORD)
  removeRecord(SETUP_RECORD)
  // The port it was started on, which the settings may no longer name.
  if (record && processes.length > 0) await waitFor(async () => !(await portInUse(record.port)), 10_000)
  return processes.length > 0
}
