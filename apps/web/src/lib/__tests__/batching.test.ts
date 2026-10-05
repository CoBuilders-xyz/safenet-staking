import { describe, it, expect } from "vitest"
import { supportsAtomicBatch } from "../batching"

describe("supportsAtomicBatch", () => {
  it.each<[string, unknown, boolean]>([
    ["EIP-5792 as final, supported", { atomic: { status: "supported" } }, true],
    ["the earlier draft, as Safe reports it", { atomicBatch: { supported: true } }, true],
    ["EIP-5792 'ready': would ask to upgrade the account first", { atomic: { status: "ready" } }, false],
    ["EIP-5792 'unsupported'", { atomic: { status: "unsupported" } }, false],
    ["the draft, not supported", { atomicBatch: { supported: false } }, false],
    ["other capabilities only", { paymasterService: { supported: true } }, false],
    ["nothing for this chain", undefined, false],
    ["null", null, false],
  ])("%s → %s", (_, capabilities, expected) => {
    expect(supportsAtomicBatch(capabilities)).toBe(expected)
  })
})
