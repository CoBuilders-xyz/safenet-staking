// Runs check-browser-safety.mjs against a scratch tree, so its bundle half is exercised. CI has
// neither a .env.local nor a dist, so without this test that half never runs there.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

const SCRIPT = resolve(import.meta.dirname, "../check-browser-safety.mjs")

/**
 * Writes .env.local and one bundle file into a fresh tree, runs the check there. `file` is the
 * bundle file's path under dist; `buildEnv`, when given, is written to apps/web/build.env.
 */
function check(envLocal, bundle, { file = "assets/index.js", buildEnv, graphApiKey = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "browser-safety-"))
  try {
    mkdirSync(join(root, "apps/web/src"), { recursive: true })
    mkdirSync(dirname(join(root, "apps/web/dist", file)), { recursive: true })
    writeFileSync(join(root, ".env.local"), envLocal)
    writeFileSync(join(root, "apps/web/dist", file), bundle)
    if (buildEnv !== undefined) writeFileSync(join(root, "apps/web/build.env"), buildEnv)
    const run = spawnSync(process.execPath, [SCRIPT], {
      env: { ...process.env, BROWSER_SAFETY_ROOT: root, VITE_GRAPH_API_KEY: graphApiKey },
      encoding: "utf8",
    })
    return { status: run.status, output: run.stdout + run.stderr }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test("a double-quoted secret present bare in the bundle fails, naming the key only", () => {
  const { status, output } = check('SECRET="plantedvalue456"\n', "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
  assert.match(output, /The value of SECRET from \.env\.local appears/)
  assert.doesNotMatch(output, /plantedvalue456/)
})

test("the same secret absent from the bundle passes", () => {
  const { status } = check('SECRET="plantedvalue456"\n', "const a=1;\n")
  assert.equal(status, 0)
})

test("a VITE_ value present in the bundle passes, because Vite inlines it by design", () => {
  const { status } = check('VITE_X="public-value-0001"\n', 'const a="public-value-0001";\n')
  assert.equal(status, 0)
})

test("a single-quoted secret present in the bundle fails", () => {
  const { status } = check("SECRET='plantedvalue456'\n", "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
})

test("a secret with an unmatched quote present in the bundle fails", () => {
  const { status } = check('SECRET="plantedvalue456\n', "const b=x+plantedvalue456;\n")
  assert.equal(status, 1)
})

test("a value of 12 characters or fewer is ignored", () => {
  const { status } = check('SHORT="twelve-chars"\n', 'const s="twelve-chars";\n')
  assert.equal(status, 0)
})

test("two keys that leak are each named once", () => {
  const { status, output } = check(
    'ONE="plantedvalue456"\nTWO="plantedvalue789"\n',
    "plantedvalue456 plantedvalue456 plantedvalue789\n",
  )
  assert.equal(status, 1)
  assert.equal(output.match(/The value of ONE /g)?.length, 1)
  assert.equal(output.match(/The value of TWO /g)?.length, 1)
})

test("a secret in index.html, outside assets, fails", () => {
  const { status, output } = check('SECRET="plantedvalue456"\n', "<script>plantedvalue456</script>\n", {
    file: "index.html",
  })
  assert.equal(status, 1)
  assert.match(output, /The value of SECRET from \.env\.local appears/)
})

test("a secret in a file that is not JavaScript, deeper in dist, fails", () => {
  const { status } = check('SECRET="plantedvalue456"\n', '{"k":"plantedvalue456"}\n', {
    file: "assets/data/manifest.json",
  })
  assert.equal(status, 1)
})

test("a non-VITE_ value that build.env also holds passes, because the release ships it", () => {
  const { status } = check('PROJECT_ID="publicvalue0123"\n', 'const p="publicvalue0123";\n', {
    buildEnv: "# public\nVITE_PROJECT_ID=publicvalue0123\n",
  })
  assert.equal(status, 0)
})

test("with build.env present, a value it does not hold still fails, naming only that key", () => {
  const { status, output } = check(
    'PROJECT_ID="publicvalue0123"\nSECRET="plantedvalue456"\n',
    "publicvalue0123 plantedvalue456\n",
    { buildEnv: "VITE_PROJECT_ID=publicvalue0123\n" },
  )
  assert.equal(status, 1)
  assert.match(output, /The value of SECRET /)
  assert.doesNotMatch(output, /PROJECT_ID/)
})

test("a key that shares its stem with a build.env key but leaks another value fails, naming it", () => {
  const { status, output } = check('PROJECT_ID="plantedvalue456"\n', "const p=plantedvalue456;\n", {
    buildEnv: "VITE_PROJECT_ID=publicvalue0123\n",
  })
  assert.equal(status, 1)
  assert.match(output, /The value of PROJECT_ID from \.env\.local appears/)
})

test("a value build.env holds under a key without VITE_ earns no exemption", () => {
  const { status, output } = check('PROJECT_ID="publicvalue0123"\n', 'const p="publicvalue0123";\n', {
    buildEnv: "PROJECT_ID=publicvalue0123\n",
  })
  assert.equal(status, 1)
  assert.match(output, /The value of PROJECT_ID /)
})


test("the explicit public gateway key is exempt, but unrelated private values still fail", () => {
  const graphApiKey = "synthetic-public-graph-key"
  assert.equal(check(`GRAPH_API_KEY=${graphApiKey}\n`, graphApiKey, { graphApiKey }).status, 0)
  assert.equal(check(`GRAPH_API_KEY=${graphApiKey}\n`, graphApiKey).status, 1)
  const result = check(`GRAPH_API_KEY=${graphApiKey}\nSECRET=private-value-123456\n`,
    `${graphApiKey} private-value-123456`, { graphApiKey })
  assert.equal(result.status, 1)
  assert.match(result.output, /The value of SECRET /)
  assert.doesNotMatch(result.output, /The value of GRAPH_API_KEY |private-value-123456|synthetic-public-graph-key/)
})


test("a private key sharing the explicit public gateway value still fails", () => {
  const graphApiKey = "synthetic-shared-value-123"
  const { status, output } = check(`GRAPH_API_KEY=${graphApiKey}\nPRIVATE_RPC_KEY=${graphApiKey}\n`,
    graphApiKey, { graphApiKey })
  assert.equal(status, 1)
  assert.match(output, /The value of PRIVATE_RPC_KEY /)
  assert.doesNotMatch(output, /The value of GRAPH_API_KEY |synthetic-shared-value-123/)
})
