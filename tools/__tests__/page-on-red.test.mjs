// page-on-red.mjs against a fake GitHub REST API: which calls it makes, in which order, and what it
// does with each answer. No network.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"
import { LABEL, failedJobs, findOpenIssue, issueTitle, page, runReport } from "../page-on-red.mjs"

const SCRIPT = resolve(import.meta.dirname, "../page-on-red.mjs")
const API = "https://api.github.test"
const REPO = "owner/repo"

/**
 * A fake fetch. `routes` maps "METHOD /path" to `{ status, body }`; an unlisted call answers 500.
 * Every call is recorded with its parsed body.
 */
function fakeGitHub(routes) {
  const calls = []
  const fetch = async (url, init) => {
    const key = `${init.method} ${url.slice(API.length)}`
    calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined, headers: init.headers, signal: init.signal })
    const route = routes[key] ?? { status: 500, body: {} }
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => route.body,
    }
  }
  return { fetch, calls }
}

const RUN = {
  api: API,
  token: "t0ken",
  repo: REPO,
  workflow: "Nightly",
  runUrl: "https://github.test/owner/repo/actions/runs/42",
  ref: "main",
  event: "schedule",
  sha: "0123456789abcdef",
  needsJson: JSON.stringify({ test: { result: "success" }, "cli-smoke": { result: "failure" } }),
}

const LABEL_OK = { [`GET /repos/${REPO}/labels/${LABEL}`]: { status: 200, body: { name: LABEL } } }
const OPEN_ISSUES = `GET /repos/${REPO}/issues?state=open&labels=${LABEL}&per_page=100`

test("no open issue for the workflow: opens one, labelled, with the run link and the failed job", async () => {
  const gh = fakeGitHub({
    ...LABEL_OK,
    [OPEN_ISSUES]: { status: 200, body: [{ number: 3, title: "Parity with SEF is red", state: "open" }] },
    [`POST /repos/${REPO}/issues`]: { status: 201, body: { number: 7 } },
  })
  const result = await page({ ...RUN, fetch: gh.fetch })
  assert.deepEqual(result, { action: "created", number: 7 })
  const created = gh.calls.at(-1)
  assert.equal(created.key, `POST /repos/${REPO}/issues`)
  assert.equal(created.body.title, "Nightly is red")
  assert.deepEqual(created.body.labels, [LABEL])
  assert.match(created.body.body, /actions\/runs\/42/)
  assert.match(created.body.body, /`cli-smoke`/)
  assert.equal(created.headers.authorization, "Bearer t0ken")
})

test("an open issue for the workflow: comments on it and opens nothing", async () => {
  const gh = fakeGitHub({
    ...LABEL_OK,
    [OPEN_ISSUES]: { status: 200, body: [{ number: 5, title: "Nightly is red", state: "open" }] },
    [`POST /repos/${REPO}/issues/5/comments`]: { status: 201, body: { id: 1 } },
  })
  const result = await page({ ...RUN, fetch: gh.fetch })
  assert.deepEqual(result, { action: "commented", number: 5 })
  assert.deepEqual(
    gh.calls.map((c) => c.key),
    [`GET /repos/${REPO}/labels/${LABEL}`, OPEN_ISSUES, `POST /repos/${REPO}/issues/5/comments`],
  )
  assert.match(gh.calls.at(-1).body.body, /actions\/runs\/42/)
})

test("never closes or edits an issue: only GET and POST", async () => {
  const gh = fakeGitHub({
    ...LABEL_OK,
    [OPEN_ISSUES]: { status: 200, body: [{ number: 5, title: "Nightly is red", state: "open" }] },
    [`POST /repos/${REPO}/issues/5/comments`]: { status: 201, body: {} },
  })
  await page({ ...RUN, fetch: gh.fetch })
  assert.ok(gh.calls.every((c) => c.key.startsWith("GET ") || c.key.startsWith("POST ")))
})

test("every API call carries a timeout signal, so a hung call cannot hold the job", async () => {
  const gh = fakeGitHub({
    ...LABEL_OK,
    [OPEN_ISSUES]: { status: 200, body: [] },
    [`POST /repos/${REPO}/issues`]: { status: 201, body: { number: 1 } },
  })
  await page({ ...RUN, fetch: gh.fetch })
  assert.ok(gh.calls.length > 0)
  for (const call of gh.calls) assert.ok(call.signal instanceof AbortSignal, `${call.key} has no signal`)
})

test("a missing label is created before the lookup", async () => {
  const gh = fakeGitHub({
    [`GET /repos/${REPO}/labels/${LABEL}`]: { status: 404, body: {} },
    [`POST /repos/${REPO}/labels`]: { status: 201, body: {} },
    [OPEN_ISSUES]: { status: 200, body: [] },
    [`POST /repos/${REPO}/issues`]: { status: 201, body: { number: 1 } },
  })
  await page({ ...RUN, fetch: gh.fetch })
  assert.equal(gh.calls[1].key, `POST /repos/${REPO}/labels`)
  assert.equal(gh.calls[1].body.name, LABEL)
})

test("a label created by another run in between (422) is not an error", async () => {
  const gh = fakeGitHub({
    [`GET /repos/${REPO}/labels/${LABEL}`]: { status: 404, body: {} },
    [`POST /repos/${REPO}/labels`]: { status: 422, body: {} },
    [OPEN_ISSUES]: { status: 200, body: [] },
    [`POST /repos/${REPO}/issues`]: { status: 201, body: { number: 1 } },
  })
  assert.deepEqual(await page({ ...RUN, fetch: gh.fetch }), { action: "created", number: 1 })
})

test("a label lookup that fails otherwise stops the run, naming the call", async () => {
  const gh = fakeGitHub({ [`GET /repos/${REPO}/labels/${LABEL}`]: { status: 403, body: {} } })
  await assert.rejects(page({ ...RUN, fetch: gh.fetch }), /GET \/repos\/owner\/repo\/labels\/ci-red answered 403/)
})

test("a label creation that fails otherwise stops the run", async () => {
  const gh = fakeGitHub({
    [`GET /repos/${REPO}/labels/${LABEL}`]: { status: 404, body: {} },
    [`POST /repos/${REPO}/labels`]: { status: 403, body: {} },
  })
  await assert.rejects(page({ ...RUN, fetch: gh.fetch }), /answered 403/)
})

test("a failed issue creation stops the run", async () => {
  const gh = fakeGitHub({ ...LABEL_OK, [OPEN_ISSUES]: { status: 200, body: [] } })
  await assert.rejects(page({ ...RUN, fetch: gh.fetch }), /POST \/repos\/owner\/repo\/issues answered 500/)
})

test("findOpenIssue matches the title exactly and skips pull requests and closed issues", () => {
  const issues = [
    { number: 1, title: "Nightly is red", state: "open", pull_request: {} },
    { number: 2, title: "Nightly is red", state: "closed" },
    { number: 3, title: "Nightly is red again", state: "open" },
    { number: 4, title: "Nightly is red", state: "open" },
  ]
  assert.equal(findOpenIssue(issues, "Nightly is red")?.number, 4)
  assert.equal(findOpenIssue(issues.slice(0, 3), "Nightly is red"), undefined)
})

test("failedJobs names only the failed jobs, sorted", () => {
  const needs = { b: { result: "failure" }, a: { result: "failure" }, c: { result: "skipped" }, d: { result: "cancelled" } }
  assert.deepEqual(failedJobs(JSON.stringify(needs)), ["a", "b"])
})

test("failedJobs is empty for a missing, malformed or non-object context", () => {
  for (const value of [undefined, "", "not json", "null", "[1]", "3"]) assert.deepEqual(failedJobs(value), [])
})

test("runReport says so when the run named no failed job", () => {
  const text = runReport({ workflow: "Nightly", runUrl: "u", ref: "main", event: "schedule", sha: "abcdef0123", failed: [] })
  assert.match(text, /Failed jobs: not named by the run/)
  assert.match(text, /commit `abcdef0`/)
})

test("issueTitle is one per workflow", () => {
  assert.equal(issueTitle("Parity with SEF"), "Parity with SEF is red")
})

test("run outside GitHub Actions, it names the missing variables and exits 1", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GITHUB_")))
  const run = spawnSync(process.execPath, [SCRIPT], { env, encoding: "utf8" })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /GITHUB_TOKEN, GITHUB_API_URL/)
})
