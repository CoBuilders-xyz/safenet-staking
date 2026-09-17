import { createPublicClient, fallback, http, parseAbiItem, formatUnits, getAddress } from "viem"
import { CHAINS, RPC_URLS } from "../src/chains.js"
import { CONTRACTS, SEF_DATA } from "../src/contracts.js"
import { stakingAbi, merkleDropAbi } from "../src/abis.js"
import type { SefValidator, SefRewardsLatest } from "../src/sef.js"
import { readFileSync } from "node:fs"

interface SnapRow { address: string; rate: number; sef: number; absences: number }

const c = createPublicClient({ chain: CHAINS.mainnet, transport: fallback(RPC_URLS.mainnet.map((u) => http(u))) })
const n = (v: bigint) => Number(formatUnits(v, 18)).toLocaleString("en-US", { maximumFractionDigits: 0 })

const [total, root, bal] = await Promise.all([
  c.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalStakedAmount" }),
  c.readContract({ address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, functionName: "merkleRoot" }),
  c.readContract({ address: CONTRACTS.safeToken.address, abi: [parseAbiItem("function balanceOf(address) view returns (uint256)")], functionName: "balanceOf", args: [CONTRACTS.merkleDrop.address] }),
])
const [vals, rewards] = (await Promise.all([
  fetch(SEF_DATA.validatorInfo).then((r) => r.json()),
  fetch(SEF_DATA.rewardsLatest).then((r) => r.json()),
])) as [SefValidator[], SefRewardsLatest]
const stakes = (await Promise.all(vals.map((v) =>
  c.readContract({ address: CONTRACTS.staking.address, abi: stakingAbi, functionName: "totalValidatorStakes", args: [getAddress(v.address)] })
))) as bigint[]
const sum = stakes.reduce((a, b) => a + b, 0n)
const shares = stakes.map((s) => Number((s * 1000000n) / sum) / 1000000)
const snap = JSON.parse(readFileSync("../../apps/web/src/lib/gnosis-snapshot.json", "utf8"))
const bySnap = new Map<string, SnapRow>(snap.participation.map((p: SnapRow) => [p.address.toLowerCase(), p]))

console.log("\n  LO QUE VA A MOSTRAR LA PAGINA\n")
console.log("  Total SAFE staked      ", n(total))
console.log("  Active validators      ", vals.length)
console.log("  Attestations per day   ", snap.attestationsPerDay.toLocaleString("en-US"))
console.log("  Attestation latency    ", `median ${snap.latencyMedianBlocks} blocks (~${snap.latencySeconds}s)`)
console.log("  Unclaimed rewards      ", n(bal), `= ${(Number(formatUnits(bal, 18)) / Number(formatUnits(BigInt(rewards.tokenTotal), 18)) * 100).toFixed(1)}% de ${n(BigInt(rewards.tokenTotal))}`)
console.log("  Merkle root matches    ", root.toLowerCase() === rewards.merkleRoot.toLowerCase())
console.log("  HHI                    ", Math.round(shares.reduce((a, p) => a + (p * 100) ** 2, 0)))
console.log("\n  tabla de validadores:")
vals.map((v, i) => ({ v, s: stakes[i]!, sh: shares[i]! })).sort((a, b) => Number(b.s - a.s))
  .forEach(({ v, s, sh }) => {
    const p = bySnap.get(v.address.toLowerCase())!
    console.log(`    ${v.label.padEnd(20)} ${(p.rate * 100).toFixed(3)}% ${p.rate === p.sef ? "OK" : "  "}  missed ${String(p.absences).padStart(5)}  ${n(s).padStart(12)} SAFE  ${(sh * 100).toFixed(1)}%`)
  })
console.log()
