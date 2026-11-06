import { test } from "node:test"
import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"
import { CHAINS } from "@cobuilders/safenet-core"
import { bytesToHex } from "viem"
import { mnemonicToAccount, toAccount } from "viem/accounts"
import { run } from "./cli.js"
import { localSigner, type Signer } from "./lib/index.js"
import { walletConnectSigner, type WalletBridge } from "./commands/walletconnect.js"
import {
  SANCTIONS_ENDPOINT, STAKER, TEST_MNEMONIC, VALIDATOR_A, fakeContext, fakeRuntime, type FakeOptions,
} from "./test-support.js"

// The compliance gates on every write, against the fake chain and fake lookups in
// test-support.ts: the sanctions oracle always, the endpoint and the geo check when asked.

const testAccount = mnemonicToAccount(TEST_MNEMONIC)
const KEY_ENV = { SAFENET_TEST_KEY: bytesToHex(testAccount.getHdKey().privateKey!) }

/** Every write command, with arguments the fake chain lets succeed. */
const WRITES: readonly (readonly string[])[] = [
  ["stake", VALIDATOR_A, "1"],
  ["unstake", VALIDATOR_A, "0.5"],
  ["withdrawals", "claim", "--all"],
  ["rewards", "claim"],
  ["rewards", "claim-and-stake", VALIDATOR_A],
]

/** A signer for STAKER that counts every signing attempt and refuses it. */
function tripwire() {
  const reached: string[] = []
  const trip = async (what: string): Promise<never> => {
    reached.push(what)
    throw new Error(`the signer was reached: ${what}`)
  }
  const account = toAccount({
    address: STAKER,
    signMessage: () => trip("signMessage"),
    signTransaction: () => trip("signTransaction"),
    signTypedData: () => trip("signTypedData"),
  })
  const loadSigner: NonNullable<FakeOptions["loadSigner"]> = async (_r, ctx): Promise<Signer> => localSigner(ctx.client, account)
  return { reached, loadSigner }
}

async function cli(argv: readonly string[], options: FakeOptions = {}) {
  const rt = fakeRuntime(options)
  const code = await run(argv, rt)
  return { code, out: rt.stdout(), err: rt.stderr(), sends: rt.sends }
}

const dry = (argv: readonly string[], ...extra: string[]) => [...argv, "--dry-run", "--from", STAKER, ...extra]

interface Report { address: string; allowed: boolean; gates: { gate: string; checked: boolean; allowed: boolean; reason: string; source: string }[] }
const gate = (r: Report, name: string) => r.gates.find((g) => g.gate === name)!

// --- the oracle, always ------------------------------------------------------------------

test("every write reads the sanctions oracle for its address, and reports the gates it passed", async () => {
  for (const argv of WRITES) {
    const json = await cli(dry(argv, "--json"))
    assert.equal(json.code, 0, `${argv.join(" ")}: ${json.err}`)
    const c = JSON.parse(json.out).compliance as Report
    assert.equal(c.address, STAKER)
    assert.equal(c.allowed, true)
    assert.deepEqual(gate(c, "sanctions oracle"), {
      gate: "sanctions oracle", checked: true, allowed: true,
      reason: "the address is not on the sanctions list", source: "chain: SanctionsList.isSanctioned(address)",
    })
    assert.equal(gate(c, "sanctions endpoint").checked, false)
    assert.equal(gate(c, "geo check").checked, false)

    const text = await cli(dry(argv))
    assert.match(text.out, /\n {2}sanctions oracle: passed, the address is not on the sanctions list \(chain: SanctionsList\.isSanctioned\(address\)\)\n/)
    assert.match(text.out, /\n {2}sanctions endpoint: not asked for\n {2}geo check: not asked for\n/)
  }
})

test("an address on the sanctions list is refused by every write before anything is signed, dry run or live", async () => {
  for (const argv of WRITES) {
    const what = argv.join(" ")
    const dryRun = await cli(dry(argv), { sanctioned: [STAKER] })
    assert.equal(dryRun.code, 1, what)
    assert.equal(dryRun.out, "", what)
    assert.equal(dryRun.err,
      `error: A compliance gate refused ${STAKER}, so nothing was signed or sent: sanctions oracle: the address is on the sanctions list.\n`)

    const { reached, loadSigner } = tripwire()
    const live = await cli([...argv, "--private-key-env", "SAFENET_TEST_KEY"], { env: KEY_ENV, loadSigner, sanctioned: [STAKER] })
    assert.equal(live.code, 1, what)
    assert.match(live.err, /sanctions oracle: the address is on the sanctions list/, what)
    assert.deepEqual(reached, [], `${what} reached the signer`)
    assert.deepEqual(live.sends, { prepared: 0, broadcast: 0 }, what)
  }
})

test("environment and keystore signers refuse sanctioned accounts on every write, dry and live", async () => {
  const keystoreAccount = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 })
  const keystore = fileURLToPath(new URL("./fixtures/keystore-anvil-1.json", import.meta.url))
  const signers = [
    { address: testAccount.address, flags: ["--private-key-env", "SAFENET_TEST_KEY"], env: KEY_ENV },
    { address: keystoreAccount.address, flags: ["--keystore", keystore, "--password-env", "PW"], env: { PW: "safenet fixture" } },
  ]
  for (const signer of signers) for (const argv of WRITES) for (const dryRun of [false, true]) {
    const r = await cli([...argv, ...signer.flags, "--json", ...(dryRun ? ["--dry-run"] : [])], {
      env: signer.env, sanctioned: [signer.address],
    })
    assert.equal(r.code, 1, r.err)
    assert.equal(JSON.parse(r.out).compliance.address, signer.address)
    assert.match(r.err, /sanctions oracle: the address is on the sanctions list/)
    assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
  }
})

test("WalletConnect passes every write through the gates before review, signature, or broadcast", async () => {
  const cases: { options: FakeOptions; flags: string[]; reason: RegExp }[] = [
    { options: { sanctioned: [STAKER] }, flags: [], reason: /sanctions oracle: the address is on the sanctions list/ },
    { options: { oracleError: true }, flags: [], reason: /sanctions oracle: the oracle could not be read/ },
    { options: { sanctionsEndpoint: 403 }, flags: ["--sanctions-endpoint", SANCTIONS_ENDPOINT], reason: /sanctions endpoint: the endpoint refused/ },
    { options: { country: "IR" }, flags: ["--geo-check"], reason: /geo check: this machine appears to be in IR/ },
  ]
  for (const argv of WRITES) for (const dryRun of [false, true]) for (const scenario of cases) {
    let paired = 0
    let reviewed = 0
    let requested = 0
    let closed = 0
    const bridge: WalletBridge = {
      connect: async () => {
        paired++
        return { uri: "wc:unit-test-pairing", approval: async () => ({
          topic: "unit-test-session",
          namespaces: { eip155: { accounts: [`eip155:${CHAINS.mainnet.id}:${STAKER}`], methods: ["eth_sendTransaction"] } },
        }) }
      },
      request: async () => { requested++; throw new Error("signature tripwire") },
      onChange: () => () => {},
      close: async () => { closed++ },
    }
    const r = await cli([...argv, "--walletconnect", "--wallet-account", STAKER, ...scenario.flags,
      ...(dryRun ? ["--dry-run"] : [])], {
      ...scenario.options,
      loadSigner: async (request, ctx) => {
        assert.equal(request.kind, "walletconnect")
        return walletConnectSigner(ctx, STAKER, bridge, {
          showUri: async () => {}, confirm: async () => { reviewed++; return true },
        })
      },
    })
    assert.equal(r.code, 1, r.err)
    assert.match(r.err, scenario.reason)
    assert.deepEqual({ paired, reviewed, requested, closed }, { paired: 1, reviewed: 0, requested: 0, closed: 1 })
    assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
  }
})

test("a refusal with --json prints the report as one document, and the sentence on stderr", async () => {
  const r = await cli(dry(["stake", VALIDATOR_A, "1"], "--json"), { sanctioned: [STAKER] })
  assert.equal(r.code, 1)
  const doc = JSON.parse(r.out) as { refused: boolean; compliance: Report }
  assert.equal(doc.refused, true)
  assert.equal(doc.compliance.allowed, false)
  assert.equal(gate(doc.compliance, "sanctions oracle").reason, "the address is on the sanctions list")
  assert.match(r.err, /^error: A compliance gate refused/)
})

test("an oracle that cannot be read refuses, failing closed, with no URL in the sentence", async () => {
  const r = await cli(dry(["stake", VALIDATOR_A, "1"]), { oracleError: true })
  assert.equal(r.code, 1)
  assert.match(r.err, /sanctions oracle: the oracle could not be read \(.*\), so the gate fails closed/)
  assert.doesNotMatch(r.err, /rpc\.invalid|https?:/)
})

// --- the endpoint, when asked ------------------------------------------------------------

test("--sanctions-endpoint passes on 200, and refuses on 403, on any other status and when unreachable", async () => {
  const argv = dry(["stake", VALIDATOR_A, "1"], "--sanctions-endpoint", SANCTIONS_ENDPOINT)
  const ok = await cli([...argv, "--json"])
  assert.equal(ok.code, 0, ok.err)
  assert.deepEqual(
    { ...gate(JSON.parse(ok.out).compliance, "sanctions endpoint") },
    { gate: "sanctions endpoint", checked: true, allowed: true, reason: "the endpoint allowed this client (HTTP 200)", source: "the operator's sanctions endpoint, GET" },
  )
  const cases: [NonNullable<FakeOptions["sanctionsEndpoint"]>, RegExp][] = [
    [403, /sanctions endpoint: the endpoint refused this client \(HTTP 403\)\.$/],
    [500, /sanctions endpoint: the endpoint answered HTTP 500, so the gate fails closed\.$/],
    ["unreachable", /sanctions endpoint: the endpoint did not answer, so the gate fails closed\.$/],
  ]
  for (const [answer, expected] of cases) {
    const r = await cli(argv, { sanctionsEndpoint: answer })
    assert.equal(r.code, 1, String(answer))
    assert.match(r.err.trim(), expected)
    assert.doesNotMatch(r.out + r.err, /sanctions\.invalid/, "the endpoint's URL was printed")
  }
})

test("endpoint fetch errors never expose credentials in CLI text or JSON", async () => {
  for (const scheme of ["HTTPS", "HtTpS", "https"]) for (const json of [false, true]) {
    const endpoint = `${scheme}://user:fixture-password@sanctions.invalid/check?key=fixture-token`
    const rt = fakeRuntime()
    // Real fetch rejects URL credentials before making any network request.
    const ctx = { ...fakeContext({}, rt.sends), fetch: globalThis.fetch }
    const code = await run(dry(["stake", VALIDATOR_A, "1"], "--sanctions-endpoint", endpoint, ...(json ? ["--json"] : [])),
      { ...rt, createContext: () => ctx })
    assert.equal(code, 1)
    assert.doesNotMatch(rt.stdout() + rt.stderr(), /fixture-password|fixture-token|sanctions\.invalid|user:/)
    assert.match(rt.stderr(), /the endpoint did not answer, so the gate fails closed/)
    if (json) assert.equal(gate(JSON.parse(rt.stdout()).compliance, "sanctions endpoint").allowed, false)
    assert.deepEqual(rt.sends, { prepared: 0, broadcast: 0 })
  }
})

test("--sanctions-endpoint takes an http or https URL, and a wrong value is not repeated", async () => {
  for (const value of ["Hunter2_not_a_url", "https://:8080", "https://user:fixture-password@:8080/?key=fixture-token", "file:///fixture-token"]) {
    const r = await cli(dry(["stake", VALIDATOR_A, "1"], "--sanctions-endpoint", value))
    assert.equal(r.code, 2)
    assert.match(r.err, /--sanctions-endpoint takes an http or https URL/)
    assert.doesNotMatch(r.out + r.err, /Hunter2|fixture-password|fixture-token|:8080/)
    assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
  }
})

// --- the geo check, when asked -----------------------------------------------------------

test("--geo-check passes outside the blocked countries and names its source", async () => {
  const r = await cli(dry(["stake", VALIDATOR_A, "1"], "--geo-check", "--json"), { country: "AR" })
  assert.equal(r.code, 0, r.err)
  assert.deepEqual(gate(JSON.parse(r.out).compliance, "geo check"), {
    gate: "geo check", checked: true, allowed: true,
    reason: "this machine appears to be in AR", source: "country.is, the country of this machine's IP address",
  })
})

test("--geo-check refuses a blocked country, before anything is signed", async () => {
  const { reached, loadSigner } = tripwire()
  const r = await cli(["stake", VALIDATOR_A, "1", "--private-key-env", "SAFENET_TEST_KEY", "--geo-check"],
    { env: KEY_ENV, loadSigner, country: "IR" })
  assert.equal(r.code, 1)
  assert.match(r.err, /geo check: this machine appears to be in IR, a blocked country\.$/m)
  assert.deepEqual(reached, [])
  assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
})

test("--geo-check falls back to the second lookup, and refuses when neither names a country", async () => {
  const second = await cli(dry(["stake", VALIDATOR_A, "1"], "--geo-check", "--json"), { geoFailing: [0] })
  assert.equal(second.code, 0, second.err)
  assert.match(gate(JSON.parse(second.out).compliance, "geo check").source, /^ipapi\.co/)

  const none = await cli(dry(["stake", VALIDATOR_A, "1"], "--geo-check"), { geoFailing: [0, 1] })
  assert.equal(none.code, 1)
  assert.match(none.err, /geo check: no lookup named a country \(country\.is: HTTP 503; ipapi\.co: HTTP 503\), so the gate fails closed/)
})

test("every refused gate is named in the one sentence", async () => {
  const r = await cli(dry(["rewards", "claim"], "--sanctions-endpoint", SANCTIONS_ENDPOINT, "--geo-check"),
    { sanctioned: [STAKER], sanctionsEndpoint: 403, country: "KP" })
  assert.equal(r.code, 1)
  assert.match(r.err, /sanctions oracle: the address is on the sanctions list; sanctions endpoint: the endpoint refused this client \(HTTP 403\); geo check: this machine appears to be in KP, a blocked country\./)
})

test("unreadable chain head produces a redacted structured refusal for every CLI write", async () => {
  for (const argv of WRITES) {
    const rt = fakeRuntime()
    const ctx = fakeContext({}, rt.sends)
    ctx.client.getBlockNumber = async () => { throw new Error("private-head-marker") }
    assert.equal(await run(dry(argv, "--json"), { ...rt, createContext: () => ctx }), 1)
    const r = JSON.parse(rt.stdout())
    assert.equal(r.refused, true)
    assert.equal(r.compliance.block, null)
    assert.equal(r.compliance.allowed, false)
    assert.match(rt.stderr(), /chain head could not be read/)
    assert.doesNotMatch(rt.stdout() + rt.stderr(), /private-head-marker/)
    assert.deepEqual(rt.sends, { prepared: 0, broadcast: 0 })
  }
})

test("status-only endpoint and failed geo responses cancel their bodies", async () => {
  let cancelled = 0
  const rt = fakeRuntime()
  const ctx = { ...fakeContext({}, rt.sends), fetch: (async (url) => new Response(new ReadableStream({
    cancel() { cancelled++ },
  }), { status: String(url) === SANCTIONS_ENDPOINT ? 200 : 503 })) as typeof fetch }
  assert.equal(await run(dry(["stake", VALIDATOR_A, "1"], "--sanctions-endpoint", SANCTIONS_ENDPOINT, "--geo-check"),
    { ...rt, createContext: () => ctx }), 1)
  assert.equal(cancelled, 3)
  assert.deepEqual(rt.sends, { prepared: 0, broadcast: 0 })
})

test("unknown geographic codes refuse every write before transaction preparation", async () => {
  for (const country of ["XX", "ZZ", "AA"]) for (const argv of WRITES) {
    const r = await cli(dry(argv, "--geo-check", "--json"), { country })
    assert.equal(r.code, 1, r.err)
    const doc = JSON.parse(r.out)
    assert.equal(doc.refused, true)
    assert.equal(gate(doc.compliance, "geo check").allowed, false)
    assert.deepEqual(r.sends, { prepared: 0, broadcast: 0 })
  }
})
