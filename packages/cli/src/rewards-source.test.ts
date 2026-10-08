import { test } from "node:test"
import assert from "node:assert/strict"
import type { Hex } from "viem"
import { SEF_DATA, SEF_REWARDS_ENS_NAME, rewardProofPath } from "@cobuilders/safenet-core"
import { run } from "./cli.js"
import { checkRewards, getStatus } from "./lib/index.js"
import { rewardsSource } from "./lib/sef.js"
import { DATASET_EPOCH, STAKER, fakeContext, fakeRuntime } from "./test-support.js"

// The reward files come from SEF's IPFS dataset when its ENS name holds a contenthash, and from
// the repository otherwise. The chain, the gateways and the repository are the fakes in
// test-support.ts, so each case sets what the ENS name holds and which source fails.

// ENSIP-7's example contenthash and its CIDv1, as core's tests decode it.
const CONTENTHASH: Hex = "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f"
const CID = "bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4"

async function statusJson(options: Parameters<typeof fakeRuntime>[0] = {}) {
  const rt = fakeRuntime(options)
  const code = await run(["status", "--json"], rt)
  assert.equal(code, 0, rt.stderr())
  return JSON.parse(rt.stdout()) as {
    rewardsEpoch: { value: { epoch: number } }
    rewardsSource: {
      kind: string; url: string; gateway: string | null; ens: Record<string, unknown>
      tried: { kind: string; outcome: string }[]
    }
  }
}

test("with an empty contenthash, status reads the repository and says why", async () => {
  const s = await statusJson()
  assert.deepEqual(s.rewardsSource, {
    kind: "repository",
    url: SEF_DATA.rewardsProofBase,
    gateway: null,
    tried: [{ kind: "repository", url: SEF_DATA.rewardsProofBase, gateway: null, outcome: "found", reason: null }],
    ens: { name: SEF_REWARDS_ENS_NAME, status: "empty", contenthash: null, reason: null },
  })
  assert.equal(s.rewardsEpoch.value.epoch, 0)
})

test("with a contenthash set, status reads SEF's dataset through the first gateway", async () => {
  const s = await statusJson({ ensContenthash: CONTENTHASH })
  assert.equal(s.rewardsSource.kind, "ens")
  assert.equal(s.rewardsSource.url, `https://ipfs.io/ipfs/${CID}`)
  assert.equal(s.rewardsSource.gateway, "https://ipfs.io")
  assert.deepEqual(s.rewardsSource.ens, {
    name: SEF_REWARDS_ENS_NAME, status: "set", contenthash: CONTENTHASH, reason: null,
  })
  assert.equal(s.rewardsEpoch.value.epoch, DATASET_EPOCH)
})

test("a failing gateway falls through to the next one", async () => {
  const s = await statusJson({ ensContenthash: CONTENTHASH, failingGateways: ["ipfs.io"] })
  assert.equal(s.rewardsSource.gateway, "https://dweb.link")
  assert.equal(s.rewardsEpoch.value.epoch, DATASET_EPOCH)
})

test("the dataset answers while the repository is down", async () => {
  const s = await statusJson({ ensContenthash: CONTENTHASH, repositoryStatus: 500 })
  assert.equal(s.rewardsSource.kind, "ens")
})

test("when every gateway fails, the repository answers and the contenthash is still reported", async () => {
  const s = await statusJson({
    ensContenthash: CONTENTHASH, failingGateways: ["ipfs.io", "dweb.link", "ipfs.filebase.io"],
  })
  assert.equal(s.rewardsSource.kind, "repository")
  assert.equal(s.rewardsSource.ens.status, "set")
  assert.equal(s.rewardsEpoch.value.epoch, 0)
})

test("when every source fails, the error names each one", async () => {
  const rt = fakeRuntime({
    ensContenthash: CONTENTHASH, failingGateways: ["ipfs.io", "dweb.link", "ipfs.filebase.io"], repositoryStatus: 503,
  })
  assert.equal(await run(["status"], rt), 1)
  assert.match(rt.stderr(), /Could not read SEF's rewards\/latest\.json from any source/)
  assert.match(rt.stderr(), /ipfs\.io: .*502.*dweb\.link.*ipfs\.filebase\.io.*raw\.githubusercontent\.com: .*503/)
})

test("a garbage contenthash is reported unsupported, and the repository is read", async () => {
  const s = await statusJson({ ensContenthash: "0xdeadbeef" })
  assert.equal(s.rewardsSource.kind, "repository")
  assert.equal(s.rewardsSource.ens.status, "unsupported")
  assert.equal(s.rewardsSource.ens.contenthash, "0xdeadbeef")
})

test("the status table names the source", async () => {
  const rt = fakeRuntime()
  await run(["status"], rt)
  assert.match(rt.stdout(), /Rewards data\s+SEF's repository, a mirror: rewards\.safenet-gov\.eth has no contenthash yet/)
  const set = fakeRuntime({ ensContenthash: CONTENTHASH })
  await run(["status"], set)
  assert.match(set.stdout(), /Rewards data\s+SEF's IPFS dataset \(ENS\), through ipfs\.io/)
})

test("rewards check reads the proof from the dataset, and the MCP library with it", async () => {
  const r = await checkRewards(fakeContext({ ensContenthash: CONTENTHASH }), STAKER)
  assert.equal(r.proofUrl, `https://ipfs.io/ipfs/${CID}/${rewardProofPath(STAKER)}`)
  assert.equal(r.earned, true)
})

test("an address the dataset and the repository both lack has no proof, settled by the repository", async () => {
  const r = await checkRewards(fakeContext({ ensContenthash: CONTENTHASH, proof: null }), STAKER)
  assert.equal(r.earned, false)
  assert.equal(r.proofUrl, `${SEF_DATA.rewardsProofBase}/${rewardProofPath(STAKER)}`)
  assert.equal(r.proofSource.kind, "repository")
})

test("an address without rewards is not an error when a gateway fails", async () => {
  // The day SEF populates the name: one gateway rate-limited, the others and the repository 404.
  const rt = fakeRuntime({ ensContenthash: CONTENTHASH, proof: null, failingGateways: ["ipfs.io"] })
  assert.equal(await run(["rewards", "check", STAKER, "--json"], rt), 0, rt.stderr())
  const r = JSON.parse(rt.stdout()) as { earned: boolean; proofSource: { tried: { outcome: string }[] } }
  assert.equal(r.earned, false)
  assert.deepEqual(r.proofSource.tried.map((t) => t.outcome), ["error", "not found", "not found", "not found"])
})

test("rewards check --json names the source of the proof", async () => {
  const rt = fakeRuntime({ ensContenthash: CONTENTHASH })
  assert.equal(await run(["rewards", "check", STAKER, "--json"], rt), 0, rt.stderr())
  const r = JSON.parse(rt.stdout()) as { proofSource: { kind: string; gateway: string } }
  assert.equal(r.proofSource.kind, "ens")
  assert.equal(r.proofSource.gateway, "https://ipfs.io")
  const text = fakeRuntime({ ensContenthash: CONTENTHASH })
  await run(["rewards", "check", STAKER], text)
  assert.match(text.stdout(), /Proof read from\s+SEF's IPFS dataset \(ENS\), through ipfs\.io/)
})

test("a dataset that answers 404 everywhere is reported as a missing file, not an outage", async () => {
  const s = await statusJson({ ensContenthash: CONTENTHASH, datasetMissing: true })
  assert.equal(s.rewardsSource.kind, "repository")
  assert.deepEqual(s.rewardsSource.tried.map((t) => [t.kind, t.outcome]), [
    ["ens", "not found"], ["ens", "not found"], ["ens", "not found"], ["repository", "found"],
  ])
  const rt = fakeRuntime({ ensContenthash: CONTENTHASH, datasetMissing: true })
  await run(["status"], rt)
  assert.match(rt.stdout(), /SEF's repository, a mirror: the IPFS dataset has no such file at the expected path/)
  const down = fakeRuntime({ ensContenthash: CONTENTHASH, failingGateways: ["ipfs.io", "dweb.link", "ipfs.filebase.io"] })
  await run(["status"], down)
  assert.match(down.stdout(), /SEF's repository, a mirror: the IPFS dataset did not answer/)
})

test("IPFS_GATEWAY is tried before the public gateways", async () => {
  const s = await statusJson({ ensContenthash: CONTENTHASH, env: { IPFS_GATEWAY: "https://gw.example.org/ipfs/" } })
  assert.equal(s.rewardsSource.gateway, "https://gw.example.org")
  assert.equal(s.rewardsSource.url, `https://gw.example.org/ipfs/${CID}`)
})

test("one context resolves the ENS name once", async () => {
  const ctx = fakeContext({ ensContenthash: CONTENTHASH })
  let lookups = 0
  const readContract = ctx.client.readContract.bind(ctx.client)
  const counted = {
    ...ctx,
    client: {
      ...ctx.client,
      readContract: ((p: { functionName: string }) => {
        if (p.functionName === "findResolver") lookups++
        return readContract(p as never)
      }) as typeof ctx.client.readContract,
    },
  }
  await getStatus(counted)
  await checkRewards(counted, STAKER)
  assert.equal(lookups, 1)
  assert.equal(await rewardsSource(counted), await rewardsSource(counted))
})
