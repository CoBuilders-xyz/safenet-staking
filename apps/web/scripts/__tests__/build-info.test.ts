import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it, expect } from "vitest"
import { parseBuildCommit, readBuildCommit } from "../build-info"

describe("build commit", () => {
  it("reads the SHA and the commit time in UTC from git's output", () => {
    expect(parseBuildCommit("0123456789abcdef0123456789abcdef01234567 1795089600\n")).toEqual({
      commit: "0123456789abcdef0123456789abcdef01234567", time: "2026-11-19T12:00:00Z",
    })
  })
  it("gives nothing for output that is not a commit", () => {
    for (const output of ["", "fatal: not a git repository", "0123456 1795089600"]) {
      expect(parseBuildCommit(output)).toBeUndefined()
    }
  })
  it("gives nothing outside a checkout", () => {
    expect(readBuildCommit("/")).toBeUndefined()
  })
  it("reads a signed HEAD when git is set to show signatures", () => {
    const dir = mkdtempSync(join(tmpdir(), "build-info-"))
    try {
      const repo = join(dir, "repo")
      const key = join(dir, "key")
      const run = (command: string, ...args: string[]) => execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      const git = (...args: string[]) => run("git", "-C", repo, ...args)
      run("ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", key)
      run("git", "init", "-q", repo)
      for (const [name, value] of [
        ["user.name", "Test"], ["user.email", "test@example.test"], ["gpg.format", "ssh"],
        ["user.signingkey", `${key}.pub`], ["commit.gpgsign", "true"], ["log.showSignature", "true"],
      ]) git("config", name, value)
      git("commit", "-q", "--allow-empty", "-m", "signed")

      // The setup holds: without the flag, git writes its signature report before the commit.
      const plain = git("show", "-s", "--format=%H %ct", "HEAD")
      expect(plain.trim().split("\n").length).toBeGreaterThan(1)
      expect(readBuildCommit(repo)?.commit).toBe(git("rev-parse", "HEAD").trim())
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
