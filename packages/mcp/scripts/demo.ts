/**
 * Records one session with safenet-mcp over stdio, against Ethereum Mainnet, and renders it as
 * docs/demo.svg: the calls an assistant makes to answer "how is Safenet doing, and what can this
 * staker do?", each with the summary the server returned.
 *
 *   pnpm --filter @cobuilders/safenet-mcp demo <staker> <claimant>
 *
 * <staker> is an address with SAFE in its wallet, for a dry-run stake; <claimant> one with rewards
 * to claim. Both are given here, not written into this file, and drawn as labels. The server runs
 * from its TypeScript, as the smoke test starts it, with writes off; MAINNET_RPC_URL comes from
 * .env.local through the package script.
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { getAddress, isAddress } from "viem"
import { redact, renderDemoSvg, type DemoStep } from "./demo-svg.js"
import { connectStdio } from "./stdio-client.js"

const [staker, claimant] = process.argv.slice(2)
if (!staker || !claimant || !isAddress(staker) || !isAddress(claimant)) {
  console.error("usage: demo <staker address> <claimant address>")
  process.exit(2)
}

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("SAFENET_MCP_")))
const server = await connectStdio(env)
const labels = new Map<string, string>([
  [staker.toLowerCase(), "<staker>"],
  [claimant.toLowerCase(), "<claimant>"],
])
const steps: { call: string; lines: string[] }[] = []
let block = ""

try {
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await server.call(name, args)
    const summary = r.content[0]?.type === "text" ? r.content[0].text : ""
    if (r.isError) throw new Error(`${name} failed: ${summary}`)
    return { summary, data: r.structuredContent as Record<string, unknown> }
  }

  const tools = (await server.client.listTools()).tools
  steps.push({ call: "tools/list", lines: [`${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`] })

  const status = await call("status")
  block = String(status.data.block)
  steps.push({ call: "status {}", lines: [status.summary] })

  const list = await call("validators_list")
  const validators = list.data.validators as { address: string; label: string | null; share: number; participation: number | null }[]
  for (const v of validators) labels.set(v.address.toLowerCase(), `<validator ${v.label ?? "unlabelled"}>`)
  steps.push({
    call: "validators_list {}",
    lines: [
      list.summary,
      validators
        .map((v) => `${v.label ?? "unlabelled"} ${(v.share * 100).toFixed(2)}% of stake, participation ${
          v.participation === null ? "not published" : `${(v.participation * 100).toFixed(1)}%`}`)
        .join(" · "),
    ],
  })

  const rewards = await call("rewards_check", { address: getAddress(claimant) })
  steps.push({ call: `rewards_check {"address": "${claimant}"}`, lines: [rewards.summary] })

  const top = validators[0]!
  const stake = await call("stake", { validator: top.address, amount: "1", from: getAddress(staker), dryRun: false })
  steps.push({ call: `stake {"validator": "${top.address}", "amount": "1", "from": "${staker}", "dryRun": false}`, lines: [stake.summary] })
} finally {
  await server.close()
}

const clean: DemoStep[] = steps.map((s) => ({ call: redact(s.call, labels), lines: s.lines.map((l) => redact(l, labels)) }))
const svg = renderDemoSvg(clean, {
  title: "safenet-mcp over stdio, Ethereum Mainnet",
  footer: `Recorded ${new Date().toISOString().slice(0, 10)} at block ${block}, Node.js ${process.version}, with the MCP SDK's client. ` +
    "Writes were off, so the stake is a dry run. Addresses are labels.",
})
const out = fileURLToPath(new URL("../docs/demo.svg", import.meta.url))
writeFileSync(out, svg)
console.log(`demo: ${out}, ${clean.length} steps`)
