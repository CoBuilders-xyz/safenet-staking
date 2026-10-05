// Deploys the subgraph in the current directory to Subgraph Studio, without a prompt.
//
// Usage, from a subgraph package after `graph build`: node ../../tools/deploy-studio.mjs <slug>
//
// The deploy key comes from GRAPH_DEPLOY_KEY in the environment and goes nowhere else.
// graph-cli 0.98 cannot read it from the environment: `graph auth` takes it as an argument or
// at a prompt and writes it in plain text to ~/.graph-cli.json, and `graph deploy` takes it as
// `--deploy-key`. An argument is visible to every process on the host, and the file outlives the
// run. So this runs graph-cli inside this process and hands it the key as an in-memory argument:
// the operating system never sees it, and nothing is written to disk.
//
// The version label is the short git SHA, with `-dirty` when the tree has uncommitted changes,
// so every Studio version names the code it was built from. VERSION_LABEL overrides it.
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

const slug = process.argv[2]
if (!slug) {
  console.error("\n  usage: node ../../tools/deploy-studio.mjs <studio-slug>\n")
  process.exit(1)
}

const key = process.env.GRAPH_DEPLOY_KEY
if (!key) {
  console.error("\n  GRAPH_DEPLOY_KEY is not set. Locally it comes from .env.local (`pnpm env:pull`);")
  console.error("  in CI, from the GRAPH_DEPLOY_KEY secret.\n")
  process.exit(1)
}
// Studio keys are 32 hex characters; graph-cli's own `auth` applies the same test. Checking it
// here turns a pasted placeholder into a clear error instead of an "auth failure" from Studio.
if (!/^[0-9a-fA-F]{32}$/.test(key)) {
  console.error("\n  GRAPH_DEPLOY_KEY is set but is not a Studio deploy key (32 hex characters).\n")
  process.exit(1)
}

function versionLabel() {
  if (process.env.VERSION_LABEL) return process.env.VERSION_LABEL
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim()
  const sha = git("rev-parse", "--short", "HEAD")
  return git("status", "--porcelain").length > 0 ? `${sha}-dirty` : sha
}

// graph-cli is a dependency of the subgraph package, not of the root, so resolve it from there.
// Its package.json is not exported; its main entry is, and the package root is two levels up.
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
