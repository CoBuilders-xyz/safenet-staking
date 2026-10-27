import { mock, test } from "node:test"
import assert from "node:assert/strict"
import { bytesToHex, numberToHex, pad, stringToBytes, zeroAddress, type Hex } from "viem"
import { normalize } from "viem/ens"
import {
  IPFS_GATEWAYS, REPOSITORY_REWARDS_BASE, RewardsReadError, SEF_REWARDS_ENS_NAME,
  datasetMiss, decodeContenthash, ipfsGateways, readRewardsEnsState, readRewardsFile, resolveRewardsSource, rewardsDataBases,
  type EnsReadClient, type RewardsDataBase,
} from "./rewards-source.js"
import { SEF_DATA } from "./contracts.js"

// ENSIP-7's own example: the contenthash of ipfs://QmRAQB6YaCyidP37UdDnjFY5vQuiBrcqdyoW1CuDgwxkD4,
// whose CIDv1 in base32 the multiformats library prints as below.
const IPFS_CONTENTHASH: Hex = "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f"
const IPFS_CID = "bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4"

// An IPNS key: a libp2p-key CID over an identity multihash of an ed25519 public key whose 32
// bytes are 1 to 32. multiformats prints the same CID as this base32 string.
const IPNS_CONTENTHASH: Hex =
  "0xe50101720024080112200102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20"
const IPNS_KEY = "bafzaajaiaejcaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqor4hza"

// A made-up resolver, so no file here types an address.
const RESOLVER = pad(numberToHex(0xe75), { size: 20 })

/** A client whose ENS name resolves to `contenthash`, or whose reads fail with `error`. */
function ensClient(
  contenthash: Hex,
  options: { resolver?: Hex; offset?: bigint; error?: Error; hang?: boolean } = {},
): EnsReadClient {
  return {
    readContract: (async (p: { functionName: string }) => {
      if (options.hang) return new Promise(() => {})
      if (options.error) throw options.error
      if (p.functionName === "findResolver") return [options.resolver ?? RESOLVER, `0x${"00".repeat(32)}`, options.offset ?? 0n]
      if (p.functionName === "contenthash") return contenthash
      throw new Error(`unexpected ${p.functionName}`)
    }) as unknown as EnsReadClient["readContract"],
  }
}

test("the ENS name is already in normalised form", () => {
  assert.equal(normalize(SEF_REWARDS_ENS_NAME), SEF_REWARDS_ENS_NAME)
})

test("ENSIP-7's IPFS example decodes to its known CIDv1", () => {
  assert.deepEqual(decodeContenthash(IPFS_CONTENTHASH), { protocol: "ipfs", cid: IPFS_CID })
})

test("a bare CIDv0 multihash decodes to the same CID as its CIDv1 form", () => {
  const v0: Hex = `0xe301${IPFS_CONTENTHASH.slice(10)}`
  assert.deepEqual(decodeContenthash(v0), { protocol: "ipfs", cid: IPFS_CID })
})

test("an IPNS key decodes to its libp2p-key CID", () => {
  assert.deepEqual(decodeContenthash(IPNS_CONTENTHASH), { protocol: "ipns", name: IPNS_KEY })
})

test("an IPNS DNSLink name, written as an identity hash over its text, decodes to the name", () => {
  const name = stringToBytes("rewards.example.org")
  const raw = bytesToHex(Uint8Array.of(0xe5, 0x01, 0x01, 0x72, 0x00, name.length, ...name))
  assert.deepEqual(decodeContenthash(raw), { protocol: "ipns", name: "rewards.example.org" })
})

test("a real DNSLink contenthash with a trailing space decodes to the bare name", () => {
  // tokens.uniswap.eth on Mainnet, read 2026-10-08: "tokens.uniswap.org " in an identity hash.
  assert.deepEqual(decodeContenthash("0xe50101700013746f6b656e732e756e69737761702e6f726720"), {
    protocol: "ipns", name: "tokens.uniswap.org",
  })
})

test("an empty contenthash decodes to nothing", () => {
  assert.equal(decodeContenthash("0x"), null)
})

test("a contenthash that is not well-formed IPFS or IPNS is refused", () => {
  assert.throws(() => decodeContenthash("0xdeadbeef"), /varint/)
  // Swarm's protocol code, 0xe4.
  assert.throws(() => decodeContenthash(`0xe40101fa011b20${"ab".repeat(32)}`), /neither IPFS nor IPNS/)
  // The multihash claims 32 bytes and carries 31.
  assert.throws(() => decodeContenthash(IPFS_CONTENTHASH.slice(0, -2) as Hex), /length/)
  assert.throws(() => decodeContenthash("0xe30" as Hex), /hex/)
})

test("an empty contenthash leaves only the repository", async () => {
  const source = await resolveRewardsSource(ensClient("0x"))
  assert.deepEqual(source.ens, { status: "empty" })
  assert.deepEqual(source.bases, [REPOSITORY_REWARDS_BASE])
})

test("a name with no resolver reads as empty", async () => {
  assert.deepEqual(await readRewardsEnsState(ensClient(IPFS_CONTENTHASH, { resolver: zeroAddress })), { status: "empty" })
})

test("a resolver found on a parent name is a wildcard resolver, reported unsupported without a read", async () => {
  const state = await readRewardsEnsState(ensClient(IPFS_CONTENTHASH, { offset: 8n }))
  assert.deepEqual(state, { status: "unsupported", raw: null, reason: "the name is served by a parent's wildcard resolver" })
})

test("an IPFS contenthash puts the dataset first, through each gateway in order, then the repository", async () => {
  const source = await resolveRewardsSource(ensClient(IPFS_CONTENTHASH))
  assert.equal(source.ens.status, "set")
  assert.deepEqual(source.bases, [
    { url: `https://ipfs.orbitor.dev/ipfs/${IPFS_CID}`, kind: "ens", gateway: "https://ipfs.orbitor.dev" },
    { url: `https://ipfs.filebase.io/ipfs/${IPFS_CID}`, kind: "ens", gateway: "https://ipfs.filebase.io" },
    REPOSITORY_REWARDS_BASE,
  ])
})

test("an IPNS contenthash builds /ipns/ URLs", async () => {
  const source = await resolveRewardsSource(ensClient(IPNS_CONTENTHASH))
  assert.equal(source.bases[0]!.url, `https://ipfs.orbitor.dev/ipns/${IPNS_KEY}`)
  assert.equal(source.bases.at(-1), REPOSITORY_REWARDS_BASE)
})

test("a configured gateway is tried before the public ones", async () => {
  const source = await resolveRewardsSource(ensClient(IPFS_CONTENTHASH), { gateway: "https://gw.example.org/" })
  assert.deepEqual(source.bases.map((b) => b.gateway), ["https://gw.example.org", ...IPFS_GATEWAYS, undefined])
})

test("a garbage contenthash is reported unsupported and falls back to the repository", async () => {
  const source = await resolveRewardsSource(ensClient("0xdeadbeef"))
  assert.equal(source.ens.status, "unsupported")
  assert.deepEqual(source.bases, [REPOSITORY_REWARDS_BASE])
})

test("a failed chain read falls back to the repository and keeps no URL path in its reason", async () => {
  const error = new Error("HTTP request failed.\nURL: https://archive.example.org/v2/secret-key-123")
  const source = await resolveRewardsSource(ensClient("0x", { error }))
  assert.deepEqual(source.ens, { status: "unreadable", reason: "HTTP request failed." })
  assert.deepEqual(source.bases, [REPOSITORY_REWARDS_BASE])

  const plain = await readRewardsEnsState(ensClient("0x", { error: new Error("fetch https://archive.example.org/v2/secret-key-123 failed") }))
  assert.equal(plain.status, "unreadable")
  assert.ok(plain.status === "unreadable" && !plain.reason.includes("secret-key"), "the key is cut")
  assert.ok(plain.status === "unreadable" && plain.reason.includes("archive.example.org"), "the host is kept")
})

test("a chain that does not answer in time reads as unreadable", async () => {
  const state = await readRewardsEnsState(ensClient("0x", { hang: true }), { timeoutMs: 20 })
  assert.deepEqual(state, { status: "unreadable", reason: "no answer within 20 ms" })
})

test("the gateway list drops an invalid or repeated entry", () => {
  assert.deepEqual(ipfsGateways("not a url"), [...IPFS_GATEWAYS])
  assert.deepEqual(ipfsGateways("ftp://gw.example.org"), [...IPFS_GATEWAYS])
  assert.deepEqual(ipfsGateways("https://ipfs.orbitor.dev/"), [...IPFS_GATEWAYS])
})

test("a configured gateway counts by its origin, so a path cannot double /ipfs/", async () => {
  assert.deepEqual(ipfsGateways("https://gw.example.org/ipfs/")[0], "https://gw.example.org")
  const source = await resolveRewardsSource(ensClient(IPFS_CONTENTHASH), { gateway: "https://gw.example.org/ipfs/" })
  assert.equal(source.bases[0]!.url, `https://gw.example.org/ipfs/${IPFS_CID}`)
})

test("only a set contenthash adds dataset bases", () => {
  assert.deepEqual(rewardsDataBases({ status: "unreadable", reason: "x" }), [REPOSITORY_REWARDS_BASE])
  assert.equal(REPOSITORY_REWARDS_BASE.url, SEF_DATA.rewardsProofBase)
})

const gateway = (host: string): RewardsDataBase => ({ url: `https://${host}/ipfs/${IPFS_CID}`, kind: "ens", gateway: `https://${host}` })
const BASES = [gateway("a.example"), gateway("b.example"), REPOSITORY_REWARDS_BASE]

/** An attempt that answers per host: a value, null for a 404, "fail", or "hang". */
function answers(by: Record<string, unknown>) {
  const asked: string[] = []
  const attempt = async (url: string, signal: AbortSignal) => {
    const host = new URL(url).host
    asked.push(host)
    const a = by[host]
    if (a === "fail") throw new Error(host === "raw.githubusercontent.com" ? "HTTP 500" : "HTTP 502")
    if (a === "hang") {
      return new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
    }
    return (a ?? null) as { from: string } | null
  }
  return { asked, attempt }
}

test("the first base that answers wins, and later bases are not asked", async () => {
  const { asked, attempt } = answers({ "a.example": { from: "a" }, "raw.githubusercontent.com": { from: "repo" } })
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt })
  assert.deepEqual(read.value, { from: "a" })
  assert.equal(read.base, BASES[0])
  assert.equal(read.url, `${BASES[0]!.url}/latest.json`)
  assert.deepEqual(read.tried.map((a) => a.outcome), ["found"])
  assert.deepEqual(asked, ["a.example"])
})

test("an error, a 404 and a wrong shape each fall through to the next base", async () => {
  const { asked, attempt } = answers({ "a.example": "fail", "b.example": null, "raw.githubusercontent.com": { from: "repo" } })
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt })
  assert.deepEqual(read.value, { from: "repo" })
  assert.equal(read.base, REPOSITORY_REWARDS_BASE)
  assert.deepEqual(asked, ["a.example", "b.example", "raw.githubusercontent.com"])
  assert.deepEqual(read.tried.map((a) => a.outcome), ["error", "not found", "found"])
  assert.equal(datasetMiss(read.tried), "unanswered")
})

test("a dataset that answers 404 on every gateway is told apart from one that did not answer", async () => {
  const { attempt } = answers({ "raw.githubusercontent.com": { from: "repo" } })
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt })
  assert.equal(read.base, REPOSITORY_REWARDS_BASE)
  assert.equal(datasetMiss(read.tried), "not found")
  assert.equal(datasetMiss([{ base: REPOSITORY_REWARDS_BASE, outcome: "found" }]), undefined)
})

test("a 404 from every base is no file, settled by the repository", async () => {
  const { attempt } = answers({})
  const read = await readRewardsFile({ bases: BASES, path: "proofs/x.json", attempt })
  assert.equal(read.value, null)
  assert.equal(read.base, REPOSITORY_REWARDS_BASE)
  assert.equal(read.url, `${REPOSITORY_REWARDS_BASE.url}/proofs/x.json`)
})

test("a gateway 404, a gateway error and a repository 404 are no file, not an error", async () => {
  // The day SEF populates the name, an address without rewards meets a rate-limited gateway.
  const { attempt } = answers({ "a.example": null, "b.example": "fail" })
  const read = await readRewardsFile({ bases: BASES, path: "proofs/x.json", attempt })
  assert.equal(read.value, null)
  assert.deepEqual(read.tried.map((a) => a.outcome), ["not found", "error", "not found"])
})

test("a timed-out gateway and a repository 404 are no file", async (t) => {
  // Date.now() is frozen; setTimeout stays real. On a loaded runner the first gateway's timer can
  // fire late enough to spend the shared budget, and b then reads "skipped": that path has its own
  // test below. Here each gateway must time out.
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 })
  t.after(() => mock.timers.reset())
  const { attempt } = answers({ "a.example": "hang", "b.example": "hang" })
  const read = await readRewardsFile({ bases: BASES, path: "proofs/x.json", attempt, timeoutMs: 30 })
  assert.equal(read.value, null)
  assert.deepEqual(read.tried.map((a) => a.outcome), ["timeout", "timeout", "not found"])
})

test("a configured override's 404 is no file", async () => {
  const override = { url: "https://mock-rewards.test", kind: "override" } as const
  const read = await readRewardsFile({ bases: [override], path: "proofs/x.json", attempt: async () => null })
  assert.equal(read.value, null)
  assert.equal(read.base, override)
})

test("no file and no 404 from the repository is an error naming every base, not a missing file", async () => {
  const { attempt } = answers({ "a.example": "fail", "raw.githubusercontent.com": "fail" })
  await assert.rejects(readRewardsFile({ bases: BASES, path: "latest.json", attempt }), (error: unknown) => {
    assert.ok(error instanceof RewardsReadError)
    assert.deepEqual(error.attempts.map((a) => a.outcome), ["error", "not found", "error"])
    assert.match(error.message, /a\.example: HTTP 502; b\.example: not found; raw\.githubusercontent\.com: HTTP 500/)
    return true
  })
})

test("an error names a relative override as given, rather than failing to parse it", async () => {
  const relative = { url: "/rewards", kind: "override" } as const
  await assert.rejects(
    readRewardsFile({ bases: [relative], path: "latest.json", attempt: async () => { throw new Error("HTTP 500") } }),
    /\/rewards: HTTP 500/,
  )
})

test("a hang at the first gateway takes its share only, so the second still answers", async () => {
  const { asked, attempt } = answers({ "a.example": "hang", "b.example": { from: "b" } })
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt, timeoutMs: 60 })
  assert.deepEqual(read.value, { from: "b" })
  assert.deepEqual(read.tried.map((a) => a.outcome), ["timeout", "found"])
  assert.deepEqual(asked, ["a.example", "b.example"])
})

test("time a fast failure leaves unused passes to the next gateway", async () => {
  // a.example fails at once, so b.example may use nearly the whole budget, not half of it.
  const slow = async (url: string, signal: AbortSignal) => {
    if (new URL(url).host === "a.example") throw new Error("HTTP 502")
    if (new URL(url).host === "raw.githubusercontent.com") return null
    return new Promise<{ from: string }>((resolve, reject) => {
      const timer = setTimeout(() => resolve({ from: "b" }), 50)
      signal.addEventListener("abort", () => (clearTimeout(timer), reject(new Error("aborted"))))
    })
  }
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt: slow, timeoutMs: 80 })
  assert.deepEqual(read.value, { from: "b" })
})

test("with the mirror down and the dataset answering 404, the read fails: a gateway's 404 proves nothing", async () => {
  // Pinned on purpose: relaxing the absence rule to trust the dataset's 404 must change this test.
  for (const [repository, outcome] of [["fail", "error"], ["hang", "timeout"]] as const) {
    const { attempt } = answers({ "raw.githubusercontent.com": repository })
    await assert.rejects(
      readRewardsFile({ bases: BASES, path: "proofs/x.json", attempt, timeoutMs: 30 }),
      (error: unknown) => {
        assert.ok(error instanceof RewardsReadError)
        assert.deepEqual(error.attempts.map((a) => a.outcome), ["not found", "not found", outcome])
        return true
      },
    )
  }
})

test("a gateway whose timer overran the shared budget leaves the next one skipped", async (t) => {
  // Date.now() is mocked; setTimeout stays real. When the first gateway's slice ends, the clock
  // jumps past the gateways' deadline, as a timer firing late would, so none is left for b.
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 })
  t.after(() => mock.timers.reset())
  const asked: string[] = []
  const attempt = async (url: string, signal: AbortSignal) => {
    const host = new URL(url).host
    asked.push(host)
    if (host === "raw.githubusercontent.com") return { from: "repo" }
    return new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => {
        mock.timers.tick(1_000)
        reject(new Error("aborted"))
      }),
    )
  }
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt, timeoutMs: 40 })
  assert.deepEqual(read.tried.map((a) => a.outcome), ["timeout", "skipped", "found"])
  assert.deepEqual(asked, ["a.example", "raw.githubusercontent.com"])
  assert.deepEqual(read.value, { from: "repo" })
  assert.equal(datasetMiss(read.tried), "unanswered")
})

test("hanging gateways share one budget, and the repository still gets its own", async () => {
  const { asked, attempt } = answers({ "a.example": "hang", "b.example": "hang", "raw.githubusercontent.com": { from: "repo" } })
  const started = Date.now()
  const read = await readRewardsFile({ bases: BASES, path: "latest.json", attempt, timeoutMs: 40 })
  assert.deepEqual(read.value, { from: "repo" })
  assert.ok(Date.now() - started < 200, "the two gateways took one budget, not two")
  assert.equal(asked.at(-1), "raw.githubusercontent.com")
})

test("cancelling the read stops it with the caller's reason", async () => {
  const { attempt } = answers({ "a.example": "hang" })
  const controller = new AbortController()
  const reading = readRewardsFile({ bases: BASES, path: "latest.json", attempt, signal: controller.signal })
  controller.abort(new Error("cancelled"))
  await assert.rejects(reading, /cancelled/)
})
