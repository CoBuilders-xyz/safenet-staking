/**
 * `pnpm fork:up`: the manual QA environment for Claim & Stake, on demand, from any machine with
 * Foundry and the archive endpoint. Safe to run again: whatever is already up and right stays.
 *
 *   1. Anvil on a fork of Mainnet at the pinned block, in its own session.
 *   2. The rewards tree: every real claimer at its amount in SEF's files, plus the test account.
 *   3. The chain baseline: new root, funded test account, topped-up MerkleDrop, snapshot.
 *   4. The proxy, which serves the app, the proofs and the RPC on one origin, and its Vite.
 *
 * Then it prints what a tester needs: the origin to open, the account to import, the amounts.
 */
import { formatEther } from "viem"
import { ensureAnvil, sefSourceLabel } from "./baseline"
import { PROXY_LOG, command, rpc, say, waitFor, type SetupRecord } from "./processes"
import { proxyStatus, startProxy, stopProxy, webAnswers } from "./proxy"
import { LOCAL_PROXY_URL, PROXY_ORIGIN, PROXY_PORT, WEB_PORT, WEB_URL } from "./settings"

async function ensureProxy(): Promise<void> {
  const status = await proxyStatus()
  switch (status) {
    case "ready":
      say("Proxy", `answers on ${LOCAL_PROXY_URL}`)
      return
    case "foreign":
      throw new Error(
        `Port ${PROXY_PORT} or ${WEB_PORT} is in use, and not by a process this tool started. Stop it, or set QA_PROXY_PORT and QA_WEB_PORT.`,
      )
    case "stale":
      say("Proxy", "restarting: it changed settings or stopped answering")
      await stopProxy()
      break
    case "absent":
      break
  }
  say("Proxy", `starting on ${LOCAL_PROXY_URL} with Vite on ${WEB_URL}, log in ${PROXY_LOG}`)
  await startProxy()
}

/** The three routes, through the proxy, as the browser will use them. */
async function verify(setup: SetupRecord): Promise<void> {
  const chainId = await rpc(`${LOCAL_PROXY_URL}/rpc`, "eth_chainId")
  if (chainId !== "0x1") throw new Error(`${LOCAL_PROXY_URL}/rpc does not answer eth_chainId with 0x1 (got ${String(chainId)})`)
  const res = await fetch(`${LOCAL_PROXY_URL}/rewards/latest.json`)
  const latest = res.ok ? ((await res.json()) as { merkleRoot?: string }) : undefined
  if (latest?.merkleRoot?.toLowerCase() !== setup.root.toLowerCase()) {
    throw new Error(`${LOCAL_PROXY_URL}/rewards/latest.json does not carry the root on chain`)
  }
  say("Checks", "eth_chainId through /rpc is 0x1, /rewards/latest.json carries the root on chain")
  if (!(await waitFor(webAnswers, 90_000, 500))) {
    throw new Error(
      `The app does not answer through the proxy after 90 s. See ${PROXY_LOG}, then run \`pnpm fork:up\` again, or \`pnpm fork:down\`.`,
    )
  }
  say("Checks", "the app answers through the proxy")
}

function summary(setup: SetupRecord): void {
  console.log(`
  The manual QA fork is up.

  Open            ${PROXY_ORIGIN}/#/rewards
  MetaMask RPC    ${PROXY_ORIGIN}/rpc  on the Ethereum Mainnet network, chain id 1
  Account         ${setup.account}  Anvil's account 0; docs/manual-qa-fork.md says how to import it
  In the wallet   ${formatEther(BigInt(setup.balance))} SAFE
  To claim        ${formatEther(BigInt(setup.claimable))} SAFE
  Fork block      ${setup.block}
  Merkle root     ${setup.root}
  Carried over    ${setup.carriedOver} real claimers at their amounts in ${sefSourceLabel}

  pnpm fork:reset   puts the chain back to this state
  pnpm fork:down    stops Anvil, Vite and the proxy
`)
}

await command(async () => {
  console.log("\n  Manual QA fork\n")
  const setup = await ensureAnvil()
  await ensureProxy()
  await verify(setup)
  summary(setup)
})
