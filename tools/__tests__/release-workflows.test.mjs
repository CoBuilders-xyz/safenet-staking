import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

// The release workflow, read from its text.
function jobs(file) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows", file), "utf8")
  const body = text.split("\njobs:\n")[1]
  assert.ok(body, `${file} has a jobs section`)
  const out = {}
  for (const part of body.split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)) {
    const name = part.match(/^ {2}([a-z][a-z0-9-]*):\n/)?.[1]
    if (name) out[name] = part
  }
  return out
}

test("the Vercel upload runs from the repository root, where the Root Directory apps/web exists", () => {
  const step = jobs("release.yml").publish.split("- name: Upload to Vercel without the production domain")[1]?.split("\n      - ")[0]
  assert.ok(step, "release.yml has the Vercel upload step")
  assert.doesNotMatch(step, /\bcd\b|working-directory:/)
  // No default working directory at workflow or job scope moves it either.
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/release.yml"), "utf8")
  assert.doesNotMatch(text, /^\s*defaults:/m)
  assert.match(step, /cp -R apps\/web\/dist\/\. \.vercel\/output\/static\//)
  assert.match(step, /deploy --prebuilt --prod --skip-domain/)
})


// A step's shell, from release.yml's publish job.
function stepScript(name) {
  const step = jobs("release.yml").publish.split(`- name: ${name}\n`)[1]?.split("\n      - ")[0]
  const script = step?.match(/ {8}run: \|\n((?: {10}.*\n|\n)+)/)?.[1]?.replace(/^ {10}/gm, "")
  assert.ok(script, `release.yml has the step "${name}"`)
  return script
}

// The promote step's shell with the real curl, against a local server that stands in for
// api.vercel.com: a curl wrapper first in PATH rewrites only the host. Each request is recorded.
async function promote(answer) {
  const requests = []
  const server = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => { body += chunk })
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, body })
      const [code, json] = answer(req.method, new URL(req.url, "http://x").pathname)
      res.writeHead(code, { "content-type": "application/json" })
      res.end(JSON.stringify(json))
    })
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const dir = mkdtempSync(join(tmpdir(), "release-promote-"))
  try {
    const curl = join(dir, "curl")
    const real = spawnSync("/bin/sh", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim()
    writeFileSync(curl, `#!/bin/bash\nargs=()\nfor a in "$@"; do args+=("\${a/https:\\/\\/api.vercel.com/http://127.0.0.1:${server.address().port}}"); done\nexec ${real} "\${args[@]}"\n`)
    chmodSync(curl, 0o755)
    const child = spawn("/bin/bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", stepScript("Give the Vercel deployment the production domain")], {
      env: {
        PATH: `${dir}:/usr/bin:/bin`, RUNNER_TEMP: dir, GITHUB_STEP_SUMMARY: join(dir, "summary"),
        VERCEL_TOKEN: "fixture", DEPLOYMENT: "https://app-abc.vercel.app", VERCEL_ORG_ID: "team_x", VERCEL_PROJECT_ID: "prj_y",
      },
    })
    let out = ""
    child.stdout.on("data", (d) => { out += d })
    child.stderr.on("data", (d) => { out += d })
    const [status] = await once(child, "close")
    return { status, out, requests }
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test("the promotion goes through Vercel's API, scoped to the team, with the token", async () => {
  const r = await promote((method, path) =>
    method === "GET" && path === "/v13/deployments/app-abc.vercel.app" ? [200, { id: "dpl_1" }]
    : method === "POST" && path === "/v10/projects/prj_y/promote/dpl_1" ? [201, {}]
    : [404, { error: { message: "unexpected" } }])
  assert.equal(r.status, 0, r.out)
  assert.deepEqual(r.requests.map(({ method, url }) => `${method} ${url}`), [
    "GET /v13/deployments/app-abc.vercel.app?teamId=team_x",
    "POST /v10/projects/prj_y/promote/dpl_1?teamId=team_x",
  ])
  assert.ok(r.requests.every((q) => q.auth === "Bearer fixture"))
  assert.equal(r.requests[1].body, "{}")
  assert.doesNotMatch(r.out, /fixture/)
})

test("a deployment the token cannot see stops before anything moves", async () => {
  const r = await promote(() => [404, { error: { message: "User not found." } }])
  assert.equal(r.status, 1)
  assert.match(r.out, /Vercel did not find .* in the team \(HTTP 404\): User not found\./)
  assert.equal(r.requests.length, 1)
})

test("a refused promotion fails the step with Vercel's reason", async () => {
  const r = await promote((method) => method === "GET" ? [200, { id: "dpl_1" }] : [403, { error: { message: "Forbidden" } }])
  assert.equal(r.status, 1)
  assert.match(r.out, /Vercel did not promote dpl_1 \(HTTP 403\): Forbidden/)
})

test("publish moves Vercel, checks it, then sets ENS, and reports which host moved", () => {
  const publish = jobs("release.yml").publish
  const order = ["Upload to Vercel without the production domain", "Give the Vercel deployment the production domain",
    "Check the Vercel production domain", "Set the ENS contenthash", "Say which host moved"].map((n) => publish.indexOf(`- name: ${n}\n`))
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), `step order ${order}`)
  assert.match(publish.split("- name: Say which host moved\n")[1], /^ {8}if: failure\(\)$/m)
  const report = (PROMOTED, CHECKED, ENS) => {
    const dir = mkdtempSync(join(tmpdir(), "release-report-"))
    try {
      const run = spawnSync("/bin/bash", ["--noprofile", "--norc", "-e", "-c", stepScript("Say which host moved")], {
        env: { PATH: "/usr/bin:/bin", PROMOTED, CHECKED, ENS, CID: "bafyfixture", GITHUB_STEP_SUMMARY: join(dir, "summary") }, encoding: "utf8",
      })
      assert.equal(run.status, 0, run.stderr)
      return readFileSync(join(dir, "summary"), "utf8").trim()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const unchanged = "Vercel production did not change. The ENS name did not change."
  // The upload failed: nothing after it ran.
  assert.equal(report("skipped", "skipped", "skipped"), unchanged)
  assert.equal(report("", "", ""), unchanged)
  // The promote request failed: Vercel may still have accepted it.
  assert.match(report("failure", "skipped", "skipped"), /^Vercel production may have moved .* The ENS name did not change\.$/)
  // Promoted with 202, but production never served the build: not proven.
  assert.match(report("success", "failure", "skipped"), /^Vercel production may have moved/)
  // Vercel verified, then the ENS step failed: its transaction may still land.
  assert.equal(report("success", "success", "failure"),
    "Vercel production serves `bafyfixture`. The ENS name may point at `bafyfixture`: read its contenthash.")
})
