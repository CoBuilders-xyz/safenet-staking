/**
 * `pnpm fork:down`: stops what `fork:up` started, the proxy with its Vite and Anvil with its
 * launcher, and nothing else. Logs and the generated proofs stay for the next run.
 */
import { stopAnvil } from "./anvil"
import { command, portInUse, say } from "./processes"
import { stopProxy } from "./proxy"
import { ANVIL_PORT, PROXY_PORT, WEB_PORT } from "./settings"

await command(async () => {
  console.log("\n  Manual QA fork: down\n")
  const proxyStopped = await stopProxy()
  say("Proxy", proxyStopped ? "stopped, with its Vite" : "was not running")
  const anvilStopped = await stopAnvil()
  say("Anvil", anvilStopped ? "stopped" : "was not running")

  for (const [name, port] of [["proxy", PROXY_PORT], ["Vite", WEB_PORT], ["Anvil", ANVIL_PORT]] as const) {
    if (await portInUse(port)) say("Port", `${port} (${name}) is still in use, by a process this tool did not start`)
  }
  console.log()
})
