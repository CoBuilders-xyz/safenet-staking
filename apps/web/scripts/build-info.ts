import { execFileSync } from "node:child_process"

/** The commit a build comes from, and when it was committed. */
export interface BuildCommit {
  /** The full SHA of HEAD. */
  commit: string
  /** The commit time, ISO 8601 in UTC. */
  time: string
}

/** Parses the output of `git show -s --format="%H %ct"`. */
export function parseBuildCommit(output: string): BuildCommit | undefined {
  const match = /^([0-9a-f]{40}) (\d+)$/.exec(output.trim())
  if (!match) return undefined
  return { commit: match[1], time: new Date(Number(match[2]) * 1000).toISOString().replace(".000Z", "Z") }
}

/**
 * HEAD of the checkout at `repo`. Both values come from the commit, never from the clock or the
 * machine, so two builds of one commit hold the same bytes and the release CID stays
 * reproducible. Undefined without git or outside a checkout. --no-show-signature keeps the
 * signature report of log.showSignature out of the output for a signed HEAD.
 */
export function readBuildCommit(repo: string): BuildCommit | undefined {
  try {
    return parseBuildCommit(execFileSync("git", ["-C", repo, "show", "-s", "--no-show-signature", "--format=%H %ct", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }))
  } catch {
    return undefined
  }
}
