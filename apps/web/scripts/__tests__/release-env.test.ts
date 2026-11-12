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
  it("takes the service URLs from the environment over build.env, and checks them", () => {
    const committed = "VITE_APP_URL=\nVITE_ALERTS_API_URL=https://old.test\n"
    expect(releaseEnvironment(committed, undefined, {
      VITE_VALIDATOR_INFO_URL: " https://api.test/v1/validators ", VITE_ALERTS_API_URL: "https://alerts.test",
    })).toEqual({ VITE_APP_URL: "", VITE_VALIDATOR_INFO_URL: "https://api.test/v1/validators", VITE_ALERTS_API_URL: "https://alerts.test" })
    expect(releaseEnvironment(committed, undefined, { VITE_ALERTS_API_URL: "  " }).VITE_ALERTS_API_URL).toBe("https://old.test")
    for (const bad of ["http://api.test", "https://user:private-marker@api.test", "https://api.test/?key=private-marker", "not a url"]) {
      expect(() => releaseEnvironment("", undefined, { VITE_VALIDATOR_INFO_URL: bad })).toThrow()
      try { releaseEnvironment("", undefined, { VITE_VALIDATOR_INFO_URL: bad }) } catch (error) { expect(String(error)).not.toContain("private-marker") }
    }
  })
  it("refuses committed gateway keys and nonpublic inputs without repeating their values", () => {
    for (const source of ["VITE_GRAPH_API_KEY=private-marker", "SECRET=private-marker"]) {
      expect(() => releaseEnvironment(source)).toThrow()
      try { releaseEnvironment(source) } catch (error) { expect(String(error)).not.toContain("private-marker") }
    }
  })
})
