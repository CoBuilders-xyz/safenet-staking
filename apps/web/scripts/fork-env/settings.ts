/**
 * Settings of the manual QA fork: `pnpm fork:up`, `pnpm fork:reset` and `pnpm fork:down`.
 *
 * Ports come from .env.ports at the repository root, which scripts/setup.sh writes per worktree,
 * so this environment never lands on a port of the fork suites or of another worktree. An
 * exported variable wins. Without either, fixed defaults, next to the suites' own.
 *
 * Everything else is an environment variable with a default; docs/manual-qa-fork.md lists them.
 * The archive endpoint is read where Anvil is started and nowhere else.
 */
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { parseEther, toHex } from "viem"
import { CHAINS, MAINNET_FORK, SEF_DATA } from "@cobuilders/safenet-core"

export const WEB_DIR = resolve(import.meta.dirname, "../..")
export const REPO_ROOT = resolve(WEB_DIR, "../..")
/** Everything the tool writes: pids, logs, the generated proofs, the setup record. Git-ignored. */
export const STATE_DIR = resolve(WEB_DIR, ".fork-env")
export const REWARDS_DIR = resolve(STATE_DIR, "rewards")

/** What the test account has to claim, in SAFE. */
export const DEFAULT_TEST_AMOUNT = "742.318640275"
/** What the test account holds in its wallet before the claim, in SAFE. */
export const DEFAULT_TEST_BALANCE = "3000"

const portsFile = resolve(REPO_ROOT, ".env.ports")
const ports = existsSync(portsFile) ? parseEnv(readFileSync(portsFile, "utf8")) : {}

function port(name: string, fallback: string): number {
  const value = process.env[name] ?? ports[name] ?? fallback
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a port number, got ${JSON.stringify(value)}`)
  return Number(value)
}

/** Anvil. Loopback only; the proxy is the way in. */
export const ANVIL_PORT = port("QA_ANVIL_PORT", "8547")
/** The Vite dev server behind the proxy. Loopback only. */
export const WEB_PORT = port("QA_WEB_PORT", "5179")
/** The proxy: the one port a browser and MetaMask talk to. */
export const PROXY_PORT = port("QA_PROXY_PORT", "5180")
/** The interface the proxy binds. Loopback unless the operator decides otherwise. */
export const PROXY_HOST = process.env.QA_PROXY_HOST ?? "127.0.0.1"
/**
 * The origin the app and MetaMask reach the proxy at. The app's bundle carries it, so an
 * operator who puts the proxy behind another host name or a TLS front sets it here.
 */
export const PROXY_ORIGIN = (process.env.QA_PROXY_ORIGIN ?? `http://127.0.0.1:${PROXY_PORT}`).replace(/\/+$/, "")

export const ANVIL_URL = `http://127.0.0.1:${ANVIL_PORT}`
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`
/** Where this machine reaches the proxy, whatever origin the bundle carries. */
export const LOCAL_PROXY_URL = (() => {
  const host = ["0.0.0.0", "::", "::0"].includes(PROXY_HOST) ? "127.0.0.1" : PROXY_HOST
  return `http://${host.includes(":") ? `[${host}]` : host}:${PROXY_PORT}`
})()

function amount(name: string, fallback: string): bigint {
  const value = process.env[name] ?? fallback
  if (!/^\d+(\.\d{1,18})?$/.test(value)) {
    throw new Error(`${name} must be a SAFE amount such as 742.5, got ${JSON.stringify(value)}`)
  }
  return parseEther(value)
}

/**
 * The chain the fork is: Mainnet, as core names it. Anvil runs under its id, so the app, which is
 * built for Mainnet, and MetaMask's Mainnet network take the fork as Mainnet.
 */
export const FORK_CHAIN = CHAINS.mainnet
export const FORK_CHAIN_ID_HEX = toHex(FORK_CHAIN.id)

/**
 * The Mainnet block the fork starts from: the fork suites' block in core, unless QA_FORK_BLOCK
 * names another. Core pins it together with SEF's data commit, whose proofs carry the root on
 * chain at it, so read there every carried-over claimer's proof verifies on the fork for good.
 * A later block, after a newer root reached the chain, needs SEF's files at a later commit, or
 * the live ones: see QA_SEF_DATA_COMMIT below.
 */
export const FORK_BLOCK: bigint = (() => {
  const value = process.env.QA_FORK_BLOCK
  if (value === undefined || value === "") return MAINNET_FORK.blockNumber
  if (!/^\d+$/.test(value)) throw new Error(`QA_FORK_BLOCK must be a block number, got ${JSON.stringify(value)}`)
  return BigInt(value)
})()
export const TEST_AMOUNT = amount("QA_TEST_AMOUNT", DEFAULT_TEST_AMOUNT)
export const TEST_BALANCE = amount("QA_TEST_BALANCE", DEFAULT_TEST_BALANCE)

/**
 * Where SEF's files are read: the proof of every carried-over claimer, latest.json, and the
 * validator list the interface shows. SEF rewrites the proofs on `main` with every new root,
 * about fortnightly, so by default they are read at the commit core pins next to the default
 * block, whose root is the one on chain at that block. QA_SEF_DATA_COMMIT names another commit,
 * or `main` for the live files.
 */
export interface SefSource {
  /** The commit, or `main`. */
  readonly ref: string
  /** Where `proofs/` and `latest.json` sit. */
  readonly rewardsBase: string
  readonly validatorInfo: string
}

export const SEF_SOURCE: SefSource = (() => {
  const ref = process.env.QA_SEF_DATA_COMMIT || MAINNET_FORK.sefData.commit
  if (ref === "main") {
    return { ref, rewardsBase: SEF_DATA.rewardsProofBase, validatorInfo: SEF_DATA.validatorInfo }
  }
  if (!/^[0-9a-f]{40}$/.test(ref)) {
    throw new Error(`QA_SEF_DATA_COMMIT must be a full commit hash or main, got ${JSON.stringify(ref)}`)
  }
  const assets = SEF_DATA.assetsAtCommit(ref)
  return { ref, rewardsBase: `${assets}/rewards`, validatorInfo: `${assets}/validator-info.json` }
})()

/**
 * The archive endpoint Anvil forks from: MAINNET_RPC_URL from the environment, else from
 * .env.local at the repository root, which `pnpm env:pull` writes. The URL carries a key, so it
 * goes into Anvil's environment and nowhere else: never into a log, never into a message.
 */
export function archiveUrl(): string {
  const file = resolve(REPO_ROOT, ".env.local")
  const local = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}
  const url = process.env.MAINNET_RPC_URL || local.MAINNET_RPC_URL
  if (!url) {
    throw new Error(
      "MAINNET_RPC_URL is not set. The fork needs an archive endpoint: run `pnpm env:pull`, or export it. " +
        "Public endpoints cannot serve state at a pinned block.",
    )
  }
  return url
}

/**
 * What a child process may inherit from this one. Everything else, a secret or not, stays here.
 * Of Node's own variables only these three: NODE_AUTH_TOKEN, for one, is a credential.
 */
const INHERITED =
  /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|LANG|LC_[A-Z_]+|TZ|TERM|COLORTERM|FORCE_COLOR|NO_COLOR|CI|NODE_OPTIONS|NODE_ENV|NODE_EXTRA_CA_CERTS|QA_[A-Z_]+|VITE_[A-Z0-9_]+)$/

/**
 * The environment of the processes the tool starts: an allowlist of this process's, so no
 * exported credential and nothing from .env.local reaches the proxy or Vite. Anvil's launcher
 * gets the archive endpoint on top. Vite reads .env.local itself and puts only VITE_ values into
 * the bundle; a VITE_ value is public by definition.
 */
export function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) if (INHERITED.test(key)) env[key] = value
  return env
}
