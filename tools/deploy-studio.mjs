// Deploys the subgraph in the current directory to Subgraph Studio, without a prompt.
//
// Usage, from a subgraph package after `graph build`: node ../../tools/deploy-studio.mjs <slug>
//
// The deploy key comes from GRAPH_DEPLOY_KEY in the environment. graph-cli 0.98 cannot read it
// from there: `graph auth` takes it as an argument or at a prompt and writes it in plain text to
// ~/.graph-cli.json, and `graph deploy` takes it as `--deploy-key`. An argument is visible to
// every process on the host, and the file outlives the run. So this replaces the `graph auth`
// path on purpose: it runs graph-cli inside this process and hands it the key as an in-memory
// argument, which keeps it off the process list and off the disk. graph-cli's own debug output
// would print that argument, so the debug switches are cleared below; anything else that dumps
// this process's arguments can still show it.
//
// The version label is the short git SHA, with `-dirty` when the tree has uncommitted changes,
// so every Studio version names the code it was built from. VERSION_LABEL overrides it.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

// The chain each Studio slug was created for. Deploying a manifest for another chain under a
// slug would replace that subgraph with the wrong one.
const NETWORK_OF_SLUG = {
  "safenet-mainnet": "mainnet",
  "safenet-gnosis": "gnosis",
}

const fail = (message) => {
  console.error(`\n  ${message}\n`)
  process.exit(1)
}

const slug = process.argv[2]
if (!slug) fail("usage: node ../../tools/deploy-studio.mjs <studio-slug>")
const expected = NETWORK_OF_SLUG[slug]
if (!expected) fail(`${slug} is not a known Studio slug: expected one of ${Object.keys(NETWORK_OF_SLUG).join(", ")}.`)

const key = process.env.GRAPH_DEPLOY_KEY
if (!key) {
  fail("GRAPH_DEPLOY_KEY is not set. Locally it comes from .env.local (`pnpm env:pull`); in CI, from the GRAPH_DEPLOY_KEY secret.")
}
// Studio keys are 32 hex characters; graph-cli's own `auth` applies the same test. Checking it
// here turns a pasted placeholder into a clear error instead of an "auth failure" from Studio.
if (!/^[0-9a-fA-F]{32}$/.test(key)) fail("GRAPH_DEPLOY_KEY is set but is not a Studio deploy key (32 hex characters).")

// `graph deploy` compiles ./subgraph.yaml, whichever package generated it last.
let manifest
try {
  manifest = readFileSync("subgraph.yaml", "utf8")
} catch {
  fail("no subgraph.yaml here. Run this from a subgraph package after `pnpm generate`.")
}
const networks = [...new Set([...manifest.matchAll(/^\s*network:\s*(\S+)\s*$/gm)].map((m) => m[1]))]
if (networks.length !== 1 || networks[0] !== expected) {
  fail(`subgraph.yaml targets ${networks.join(", ") || "no network"}, but ${slug} is the ${expected} subgraph.`)
}

function versionLabel() {
  if (process.env.VERSION_LABEL) return process.env.VERSION_LABEL
  const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  try {
    const sha = git("rev-parse", "--short", "HEAD")
    return git("status", "--porcelain").length > 0 ? `${sha}-dirty` : sha
  } catch {
    fail("could not read the git SHA for the version label. Set VERSION_LABEL to deploy outside a git checkout.")
  }
}

// oclif prints the parsed arguments, the key among them, when DEBUG or CLI_FLAGS_DEBUG is set.
// The `debug` package reads DEBUG once, when it is first imported, so clear both before oclif
// loads. graph-cli's update check spawns a detached child that inherits this environment, key
// included, so turn it off.
delete process.env.DEBUG
delete process.env.CLI_FLAGS_DEBUG
process.env.GRAPH_SKIP_NEW_VERSION_CHECK = "1"

// graph-cli is a dependency of the subgraph package, not of the root, so resolve it from there.
// Its package.json has no exports map, so require.resolve finds its main entry, dist/index.js;
// the package root is two levels up from that.
const fromPackage = createRequire(join(process.cwd(), "package.json"))
const cliRoot = dirname(dirname(fromPackage.resolve("@graphprotocol/graph-cli")))
const { execute } = await import(
  pathToFileURL(createRequire(join(cliRoot, "package.json")).resolve("@oclif/core")).href
)

const label = versionLabel()
console.log(`\n  deploying ${slug} to Subgraph Studio, version ${label}\n`)

// `graph deploy` exits the process itself when Studio answers, with 0 on success.
await execute({
  dir: pathToFileURL(join(cliRoot, "bin", "run.js")).href,
  args: ["deploy", slug, "--deploy-key", key, "--version-label", label],
})
