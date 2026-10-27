#!/usr/bin/env node
// Makes a red scheduled workflow reach a person.
//
// A failed job shows a red cross on the Actions page, and nobody looks there: the nightly run was
// red for six days before anyone saw it. An issue notifies everyone who watches the repository,
// and stays open in the issue list until someone closes it.
//
// One open issue per workflow, labelled `ci-red`, titled "<workflow> is red". The first red run
// opens it; each later red run comments on it, with the run link, so the issue counts the runs
// that failed while it stayed open. This script never closes an issue: a person closes it once
// the cause is fixed, and the next red run opens a new one.
//
// Runs as the last job of a workflow, `if: failure()`, with `permissions: issues: write`. Every
// input comes from the environment GitHub Actions sets, plus NEEDS_JSON, the `needs` context of
// that job, which names the jobs that failed:
//
//   GITHUB_TOKEN GITHUB_API_URL GITHUB_SERVER_URL GITHUB_REPOSITORY GITHUB_RUN_ID
//   GITHUB_WORKFLOW GITHUB_REF_NAME GITHUB_EVENT_NAME GITHUB_SHA NEEDS_JSON
import { pathToFileURL } from "node:url"

export const LABEL = "ci-red"
const LABEL_COLOR = "d73a4a"
const LABEL_DESCRIPTION = "A scheduled workflow failed. Close once the cause is fixed."

const REQUIRED = [
  "GITHUB_TOKEN",
  "GITHUB_API_URL",
  "GITHUB_SERVER_URL",
  "GITHUB_REPOSITORY",
  "GITHUB_RUN_ID",
  "GITHUB_WORKFLOW",
  "GITHUB_REF_NAME",
  "GITHUB_EVENT_NAME",
  "GITHUB_SHA",
]

/** The title of the one open issue for a workflow. The lookup matches it exactly. */
export function issueTitle(workflow) {
  return `${workflow} is red`
}

/**
 * The jobs whose result is `failure`, from the `needs` context as JSON, sorted by name. Empty when
 * the context is empty or not an object; a malformed value must not stop the page.
 */
export function failedJobs(needsJson) {
  let needs
  try {
    needs = JSON.parse(needsJson ?? "")
  } catch {
    return []
  }
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) return []
  return Object.entries(needs)
    .filter(([, job]) => job?.result === "failure")
    .map(([name]) => name)
    .sort()
}

/** The text of the issue, or of the comment, for one red run. */
export function runReport({ workflow, runUrl, ref, event, sha, failed }) {
  const jobs = failed.length > 0 ? failed.map((name) => `\`${name}\``).join(", ") : "not named by the run"
  return [
    `**${workflow}** failed.`,
    "",
    `- Run: ${runUrl}`,
    `- Failed jobs: ${jobs}`,
    `- Ref: \`${ref}\`, commit \`${sha.slice(0, 7)}\`, triggered by \`${event}\``,
    "",
    "Close this issue once the cause is fixed. The next red run opens a new one.",
  ].join("\n")
}

/** The open issue with exactly this title, not a pull request; undefined when there is none. */
export function findOpenIssue(issues, title) {
  return issues.find((issue) => !issue.pull_request && issue.state === "open" && issue.title === title)
}

/** One GitHub REST call. Throws with the method, the path and the status when it fails. */
async function call(fetchImpl, { api, token }, method, path, body) {
  const response = await fetchImpl(`${api}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const error = new Error(`${method} ${path} answered ${response.status}`)
    error.status = response.status
    throw error
  }
  return response.status === 204 ? undefined : response.json()
}

/**
 * Opens the workflow's issue, or comments on the open one. Creates the label first when the
 * repository has none, because an issue created with an unknown label drops it silently.
 * Returns what it did: `{ action: "created" | "commented", number }`.
 */
export async function page({ fetch: fetchImpl = fetch, api, token, repo, workflow, runUrl, ref, event, sha, needsJson }) {
  const client = { api, token }
  const title = issueTitle(workflow)
  const body = runReport({ workflow, runUrl, ref, event, sha, failed: failedJobs(needsJson) })

  try {
    await call(fetchImpl, client, "GET", `/repos/${repo}/labels/${LABEL}`)
  } catch (error) {
    if (error.status !== 404) throw error
    try {
      await call(fetchImpl, client, "POST", `/repos/${repo}/labels`, {
        name: LABEL,
        color: LABEL_COLOR,
        description: LABEL_DESCRIPTION,
      })
    } catch (createError) {
      // 422: another run created it between the two calls.
      if (createError.status !== 422) throw createError
    }
  }

  const open = await call(fetchImpl, client, "GET", `/repos/${repo}/issues?state=open&labels=${LABEL}&per_page=100`)
  const existing = findOpenIssue(open, title)
  if (existing) {
    await call(fetchImpl, client, "POST", `/repos/${repo}/issues/${existing.number}/comments`, { body })
    return { action: "commented", number: existing.number }
  }
  const created = await call(fetchImpl, client, "POST", `/repos/${repo}/issues`, { title, body, labels: [LABEL] })
  return { action: "created", number: created.number }
}

async function main() {
  const missing = REQUIRED.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(`page-on-red: ${missing.join(", ")} not set. Run it as a job of a GitHub Actions workflow.`)
    process.exit(1)
  }
  const env = process.env
  const result = await page({
    api: env.GITHUB_API_URL,
    token: env.GITHUB_TOKEN,
    repo: env.GITHUB_REPOSITORY,
    workflow: env.GITHUB_WORKFLOW,
    runUrl: `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    ref: env.GITHUB_REF_NAME,
    event: env.GITHUB_EVENT_NAME,
    sha: env.GITHUB_SHA,
    needsJson: env.NEEDS_JSON,
  })
  console.log(`page-on-red: ${result.action} issue #${result.number}, "${issueTitle(env.GITHUB_WORKFLOW)}".`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`page-on-red: ${error.message}`)
    process.exit(1)
  })
}
