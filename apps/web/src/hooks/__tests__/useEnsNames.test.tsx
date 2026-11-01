import { i18n } from "@/i18n"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { queryWrapper } from "@/__tests__/subgraph-mocks"
import { activeChain } from "@/config/chains"
import { displayName, nameSourceCaption, useEnsNames, type EnsLookup } from "../useEnsNames"

const { mockGetEnsName } = vi.hoisted(() => ({ mockGetEnsName: vi.fn() }))
vi.mock("wagmi", () => ({ useConfig: () => ({ fake: "config" }) }))
vi.mock("wagmi/actions", () => ({ getEnsName: (config: unknown, args: unknown) => mockGetEnsName(config, args) }))

const v1 = TEST_ACCOUNTS.validator1
const v2 = TEST_ACCOUNTS.validator2

describe("useEnsNames", () => {
  beforeEach(() => {
    mockGetEnsName.mockReset()
  })

  it("reverse-resolves each address on the active chain: a name, or none", async () => {
    mockGetEnsName.mockImplementation(async (_c: unknown, { address }: { address: string }) => (address === v1 ? "gnosis.eth" : null))
    const { result } = renderHook(() => useEnsNames([v1, v2]), { wrapper: queryWrapper() })
    await waitFor(() => expect(result.current.get(v2.toLowerCase())).toEqual({ status: "none" }))

    expect(result.current.get(v1.toLowerCase())).toEqual({ status: "found", name: "gnosis.eth" })
    expect(mockGetEnsName).toHaveBeenCalledWith({ fake: "config" }, { address: v1, chainId: activeChain.id })
  })

  it("reads loading first, and failed when ENS cannot be read", async () => {
    mockGetEnsName.mockRejectedValue(new Error("RPC down"))
    const { result } = renderHook(() => useEnsNames([v1]), { wrapper: queryWrapper() })
    expect(result.current.get(v1.toLowerCase())).toEqual({ status: "loading" })
    await waitFor(() => expect(result.current.get(v1.toLowerCase())).toEqual({ status: "failed" }))
  })
})

describe("displayName", () => {
  it("takes the ENS name, else SEF's label, else none", () => {
    expect(displayName({ status: "found", name: "a.eth" }, "A")).toEqual({ name: "a.eth", source: "ens" })
    expect(displayName({ status: "none" }, "A")).toEqual({ name: "A", source: "sef" })
    expect(displayName({ status: "failed" }, "A")).toEqual({ name: "A", source: "sef" })
    expect(displayName(undefined, undefined)).toEqual({ name: undefined, source: "address" })
  })
})

describe("nameSourceCaption", () => {
  const none: EnsLookup = { status: "none" }
  it("names the source for one validator and for a list", () => {
    expect(nameSourceCaption([none], i18n.t)).toBe("Names: SEF labels. No ENS primary name is set.")
    expect(nameSourceCaption([none, none], i18n.t)).toBe("Names: SEF labels. No ENS primary name is set.")
    expect(nameSourceCaption([{ status: "found", name: "a.eth" }], i18n.t)).toBe("Names: ENS primary names, verified by reverse resolution; SEF labels where no name is set.")
    expect(nameSourceCaption([{ status: "found", name: "a.eth" }, none], i18n.t)).toMatch(/^Names: ENS primary names/)
    expect(nameSourceCaption([none, { status: "loading" }], i18n.t)).toBe("Names: SEF labels while ENS is read.")
    expect(nameSourceCaption([{ status: "failed" }, none], i18n.t)).toBe("Names: SEF labels. ENS could not be read.")
  })
})
