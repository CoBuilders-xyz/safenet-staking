/**
 * Starts, checks and stops the proxy this tool owns, and the Vite it runs. The same ownership
 * rule as for Anvil: only the processes in .fork-env/proxy.json, still running with the start
 * times recorded there, are ever stopped.
 */
import {
  PROXY_LOG, PROXY_RECORD, ownership, portInUse, readRecord, removeRecord, sleep, startDetached, stillRunning, terminate,
  waitFor, type Owned, type ProxyRecord,
} from "./processes"
import {
  ANVIL_PORT, FORK_BLOCK, LOCAL_PROXY_HOST, LOCAL_PROXY_URL, PROXY_HOST, PROXY_ORIGIN, PROXY_PORT, SEF_SOURCE, WEB_PORT,
  childEnvironment, localHost,
} from "./settings"

/** The proxy itself answers: a preflight on /rpc needs neither Anvil nor Vite. */
export async function proxyAnswers(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_PROXY_URL}/rpc`, { method: "OPTIONS", signal: AbortSignal.timeout(5_000) })
    return res.status === 204
  } catch {
    return false
  }
}

/** Vite answers through the proxy. */
export async function webAnswers(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_PROXY_URL}/`, { signal: AbortSignal.timeout(5_000) })
    return res.ok
  } catch {
    return false
  }
}

/**
 * The processes of this tool's proxy that still run. Empty when there is no such proxy. Fails,
 * keeping the record, when one may run but its start time cannot be read.
 */
function ownProcesses(record: ProxyRecord | undefined): Owned[] {
  if (!record) return []
  return stillRunning([record.proxy, record.vite])
}

function asWanted(r: ProxyRecord): boolean {
  return (
    r.host === PROXY_HOST &&
    r.proxyPort === PROXY_PORT &&
    r.webPort === WEB_PORT &&
    r.anvilPort === ANVIL_PORT &&
    r.origin === PROXY_ORIGIN &&
    r.validatorInfo === SEF_SOURCE.validatorInfo &&
    r.scanFrom === FORK_BLOCK.toString()
  )
}

export type ProxyStatus = "ready" | "stale" | "absent" | "foreign"

/** Why `fork:up` stops when a port the settings name is held by a process this tool did not start. */
export const foreignPorts = (): Error =>
  new Error(
    `Port ${PROXY_PORT} or ${WEB_PORT} is in use, and not by a process this tool started. Stop it, or set QA_PROXY_PORT and QA_WEB_PORT.`,
  )

/** Whether a port the settings name is held by something other than the proxy and Vite of `record`. */
async function portTakenBesides(record: ProxyRecord | undefined): Promise<boolean> {
  const ours = record ? [record.proxyPort, record.webPort] : []
  // The proxy binds QA_PROXY_HOST, which may not be loopback; Vite always binds loopback.
  for (const [port, host] of [[PROXY_PORT, LOCAL_PROXY_HOST], [WEB_PORT, "127.0.0.1"]] as const) {
    if (!ours.includes(port) && (await portInUse(port, host))) return true
  }
  return false
}

export async function proxyStatus(): Promise<ProxyStatus> {
  const record = readRecord<ProxyRecord>(PROXY_RECORD)
  if (ownProcesses(record).length === 0) {
    removeRecord(PROXY_RECORD)
    return (await portTakenBesides(undefined)) ? "foreign" : "absent"
  }
  if (!record || !asWanted(record)) {
    // Ours runs on other ports, and something else holds one the settings name. Restarting would
    // stop ours and still find the port taken, so leave both alone.
    return (await portTakenBesides(record)) ? "foreign" : "stale"
  }
  if (!(await proxyAnswers())) return "stale"
  return "ready"
}

/**
 * Starts the proxy detached and resolves once the record names this launch's proxy and Vite,
 * both still running, and the proxy answers. The proxy writes the record only once it listens,
 * so what answers is it. Refuses when a port is taken: whatever holds it is not this tool's.
 * Fails, with the log named, when the proxy does not come up or exits first. Vite takes a few
 * seconds longer.
 */
export async function startProxy(): Promise<void> {
  if (await portTakenBesides(undefined)) throw foreignPorts()
  removeRecord(PROXY_RECORD)
  const launcher = startDetached("proxy-launcher.ts", PROXY_LOG, childEnvironment())
  const ours = (r: ProxyRecord | undefined): boolean =>
    !!r &&
    r.proxy.pid === launcher.pid &&
    r.proxyPort === PROXY_PORT &&
    ownership(r.proxy) === "ours" &&
    ownership(r.vite) === "ours"
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (ours(readRecord<ProxyRecord>(PROXY_RECORD)) && (await proxyAnswers())) return
    if (launcher.exitCode !== null || launcher.signalCode !== null) break
    await sleep(250)
  }
  await stopProxy()
  throw new Error(`The proxy did not come up on ${LOCAL_PROXY_URL}. See ${PROXY_LOG}.`)
}

/** Stops this tool's proxy and its Vite, if any, and forgets them. Answers whether there was one. */
export async function stopProxy(): Promise<boolean> {
  const record = readRecord<ProxyRecord>(PROXY_RECORD)
  const processes = ownProcesses(record)
  for (const o of processes) await terminate(o)
  removeRecord(PROXY_RECORD)
  // The host and ports they were started on, which the settings may no longer name.
  if (record && processes.length > 0) {
    const proxyHost = localHost(record.host)
    await waitFor(async () => !(await portInUse(record.proxyPort, proxyHost)) && !(await portInUse(record.webPort)), 10_000)
  }
  return processes.length > 0
}
