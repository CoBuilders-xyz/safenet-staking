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
})
