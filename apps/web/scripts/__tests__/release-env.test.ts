import { describe, it, expect } from "vitest"
import { releaseEnvironment } from "../release-env"

describe("release inputs", () => {
  it("injects only the explicitly supplied public gateway key", () => {
    expect(releaseEnvironment("VITE_APP_URL=https://app.test\n", " test-only-gateway ")).toEqual({
      VITE_APP_URL: "https://app.test", VITE_GRAPH_API_KEY: "test-only-gateway",
    })
  })
  it("keeps the no-key Studio release reproducible", () => {
    expect(releaseEnvironment("VITE_APP_URL=\n", " ")).toEqual({ VITE_APP_URL: "" })
  })
  it("refuses committed gateway keys and nonpublic inputs without repeating their values", () => {
    for (const source of ["VITE_GRAPH_API_KEY=private-marker", "SECRET=private-marker"]) {
      expect(() => releaseEnvironment(source)).toThrow()
      try { releaseEnvironment(source) } catch (error) { expect(String(error)).not.toContain("private-marker") }
    }
  })
})
