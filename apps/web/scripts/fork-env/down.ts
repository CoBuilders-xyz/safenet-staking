/**
 * `pnpm fork:down`: stops what `fork:up` started, the proxy with its Vite and Anvil with its
 * launcher, and nothing else. Logs and the generated proofs stay for the next run.
 */
import { stopAnvil } from "./anvil"
import { command, portInUse, say } from "./processes"
import { stopProxy } from "./proxy"
import { ANVIL_PORT, LOCAL_PROXY_HOST, PROXY_PORT, WEB_PORT } from "./settings"

await command(async () => {
  console.log("\n  Manual QA fork: down\n")
  const proxyStopped = await stopProxy()
  say("Proxy", proxyStopped ? "stopped, with its Vite" : "was not running")
  const anvilStopped = await stopAnvil()
  say("Anvil", anvilStopped ? "stopped" : "was not running")

  const probes = [["proxy", PROXY_PORT, LOCAL_PROXY_HOST], ["Vite", WEB_PORT, "127.0.0.1"], ["Anvil", ANVIL_PORT, "127.0.0.1"]] as const
  for (const [name, port, host] of probes) {
    if (await portInUse(port, host)) say("Port", `${port} (${name}) is still in use, by a process this tool did not start`)
  }
  console.log()
})
