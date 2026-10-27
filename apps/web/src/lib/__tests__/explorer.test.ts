import { describe, it, expect } from "vitest"
import { activeChain } from "@/config/chains"
import { explorerAddressUrl, explorerBlockUrl, explorerName, explorerTxUrl } from "../explorer"

const base = activeChain.blockExplorers?.default.url
const HASH = `0x${"ab".repeat(32)}`

describe("explorer links", () => {
  it("builds address, transaction and block pages on the active chain's explorer", () => {
    expect(explorerName).toBe(activeChain.blockExplorers?.default.name)
    expect(explorerAddressUrl("0x1234")).toBe(`${base}/address/0x1234`)
    expect(explorerTxUrl(HASH)).toBe(`${base}/tx/${HASH}`)
    expect(explorerBlockUrl(24_741_826n)).toBe(`${base}/block/24741826`)
    expect(explorerBlockUrl(1)).toBe(`${base}/block/1`)
  })
})
