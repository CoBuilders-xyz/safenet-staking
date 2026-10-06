/**
 * Starts, checks and stops the proxy this tool owns, and the Vite it runs. The same ownership
 * rule as for Anvil: only the processes in .fork-env/proxy.json, still running with the start
 * times recorded there, are ever stopped.
 */
import {
  PROXY_LOG, PROXY_RECORD, alive, owned, portInUse, readRecord, removeRecord, sleep, startDetached, terminate, waitFor,
  type Owned, type ProxyRecord,
} from "./processes"
import { ANVIL_PORT, LOCAL_PROXY_URL, PROXY_HOST, PROXY_ORIGIN, PROXY_PORT, SEF_SOURCE, WEB_PORT, childEnvironment } from "./settings"

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

function ownProcesses(record: ProxyRecord | undefined): Owned[] {
  if (!record) return []
  return [record.proxy, record.vite].filter(owned)
}

function asWanted(r: ProxyRecord): boolean {
  return (
    r.host === PROXY_HOST &&
    r.proxyPort === PROXY_PORT &&
    r.webPort === WEB_PORT &&
    r.anvilPort === ANVIL_PORT &&
    r.origin === PROXY_ORIGIN &&
    r.validatorInfo === SEF_SOURCE.validatorInfo
  )
}

export type ProxyStatus = "ready" | "stale" | "absent" | "foreign"

export async function proxyStatus(): Promise<ProxyStatus> {
  const record = readRecord<ProxyRecord>(PROXY_RECORD)
  if (ownProcesses(record).length === 0) {
    removeRecord(PROXY_RECORD)
    return (await portInUse(PROXY_PORT)) || (await portInUse(WEB_PORT)) ? "foreign" : "absent"
  }
  if (!record || !asWanted(record)) return "stale"
  if (!(await proxyAnswers())) return "stale"
  return "ready"
}

/** Starts the proxy detached and resolves once it answers. Vite takes a few seconds longer. */
export async function startProxy(): Promise<void> {
  removeRecord(PROXY_RECORD)
  const launcherPid = startDetached("proxy-launcher.ts", PROXY_LOG, childEnvironment())
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    if (await proxyAnswers()) return
    if (!alive(launcherPid)) break
    await sleep(250)
  }
  await stopProxy()
  throw new Error(`The proxy did not come up on ${LOCAL_PROXY_URL}. See ${PROXY_LOG}.`)
}

/** Stops this tool's proxy and its Vite, if any, and forgets them. Answers whether there was one. */
export async function stopProxy(): Promise<boolean> {
  const processes = ownProcesses(readRecord<ProxyRecord>(PROXY_RECORD))
  for (const o of processes) await terminate(o)
  removeRecord(PROXY_RECORD)
  if (processes.length > 0) {
    await waitFor(async () => !(await portInUse(PROXY_PORT)) && !(await portInUse(WEB_PORT)), 10_000)
  }
  return processes.length > 0
}
