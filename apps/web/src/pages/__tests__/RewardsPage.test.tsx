import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import type { RewardProof } from "@/hooks/useRewardProof"
import type { useRewards } from "@/hooks/useRewards"
import type { useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { RewardsPage } from "../RewardsPage"

const SAFE = 10n ** 18n
const ROOT_A = "0x" + "ab".repeat(32)
const ROOT_B = "0x" + "cd".repeat(32)
const { merkleDrop } = getContractAddresses(activeChain.id)

type Rewards = ReturnType<typeof useRewards>
type Programme = ReturnType<typeof useProgrammeRewards>

const { mockUseAccount, mockUseRewards, mockUseProgramme, mockWrongNetwork, mockBalance } = vi.hoisted(() => ({
  mockUseAccount: vi.fn(),
  mockUseRewards: vi.fn(),
  mockUseProgramme: vi.fn(),
  mockWrongNetwork: vi.fn(() => false),
  mockBalance: vi.fn((): bigint | undefined => undefined),
}))

vi.mock("wagmi", () => ({ useAccount: () => mockUseAccount() }))
vi.mock("@/hooks/useRewards", () => ({ useRewards: () => mockUseRewards() }))
vi.mock("@/hooks/useProgrammeRewards", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useProgrammeRewards")>()),
  useProgrammeRewards: () => mockUseProgramme(),
}))
vi.mock("@/hooks/useWrongNetwork", () => ({ useWrongNetwork: () => mockWrongNetwork() }))
vi.mock("@/components/wallet/ConnectButton", () => ({
  ConnectButton: () => <button>Connect Wallet</button>,
}))
vi.mock("@/hooks/useTokenBalance", () => ({ useTokenBalance: () => ({ data: mockBalance() }) }))
vi.mock("@/components/dashboard/ClaimRewardsDialog", () => ({
  ClaimRewardsDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">Claim dialog</div> : null),
}))
vi.mock("@/components/rewards/ClaimAndStakeDialog", () => ({
  ClaimAndStakeDialog: ({ open, mode }: { open: boolean; mode: string }) =>
    open ? <div role="dialog">Claim and stake dialog, mode {mode}</div> : null,
}))

const PROOF: RewardProof = {
  cumulativeAmount: (100n * SAFE).toString(),
  merkleRoot: ROOT_A as `0x${string}`,
  proof: [("0x" + "11".repeat(32)) as `0x${string}`],
}

function rewards(overrides: Partial<Omit<Rewards, "data">> & { data?: Partial<Rewards["data"]> } = {}): Rewards {
  const { data, ...rest } = overrides
  return {
    data: { claimable: 60n * SAFE, totalClaimed: 40n * SAFE, canClaim: true, rootStale: false, ...data },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    reload: vi.fn(),
    proof: PROOF,
    hasMerkleDrop: true,
    ...rest,
  }
}

const LATEST = {
  epoch: 3,
  merkleRoot: ROOT_A,
  rewardsUntil: "2026-09-22T00:00:00.000Z",
  tokenTotal: (1000n * SAFE).toString(),
  unpaidAmount: "0",
  updatedAt: "2026-09-22T08:55:44.268Z",
}

/** Only the fields the page reads; the casts stand in for TanStack's large result types. */
function programme(overrides: Partial<Record<keyof Programme, unknown>> = {}): Programme {
  return {
    merkleDrop,
    latest: { data: LATEST, error: null, refetch: vi.fn() },
    onChainRoot: { data: ROOT_A, error: null, refetch: vi.fn() },
    dropBalance: { data: 300n * SAFE, error: null, refetch: vi.fn() },
    totals: { allocated: 1000n * SAFE, unclaimed: 300n * SAFE, claimed: 700n * SAFE, unclaimedPercent: 30 },
    rootMatches: true,
    ...overrides,
  } as unknown as Programme
}

function renderPage() {
  return render(
    <TooltipProvider>
      <RewardsPage />
    </TooltipProvider>,
  )
}

function section(name: string) {
  return screen.getByRole("region", { name })
}

/** The value printed next to a label in a section's definition list. */
function valueOf(region: HTMLElement, label: string) {
  return within(region).getByText(label).nextElementSibling as HTMLElement
}

describe("RewardsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAccount.mockReturnValue({ isConnected: true, address: TEST_ACCOUNTS.user })
    mockUseRewards.mockReturnValue(rewards())
    mockUseProgramme.mockReturnValue(programme())
    mockWrongNetwork.mockReturnValue(false)
    mockBalance.mockReturnValue(5n * SAFE)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders the four sections, each naming its source", () => {
    renderPage()

    expect(screen.getByRole("heading", { name: "Rewards" })).toBeInTheDocument()
    expect(within(section("Your rewards")).getByText(/SEF's published reward file/)).toBeInTheDocument()
    expect(within(section("Actions")).getByText(/MerkleDrop contract on Ethereum/)).toBeInTheDocument()
    expect(within(section("Programme")).getByRole("link", { name: "rewards/latest.json" })).toBeInTheDocument()
    expect(within(section("Verifiability")).getByText(/On-chain root and balance/)).toBeInTheDocument()
  })

  describe("Your rewards", () => {
    it("explains and prompts to connect when disconnected", () => {
      mockUseAccount.mockReturnValue({ isConnected: false })
      renderPage()

      const yours = section("Your rewards")
      expect(within(yours).getByText(/Connect a wallet to see what it earned/)).toBeInTheDocument()
      expect(within(yours).getByRole("button", { name: "Connect Wallet" })).toBeInTheDocument()
    })

    it("shows available, cumulative and claimed amounts", () => {
      renderPage()

      const yours = section("Your rewards")
      expect(valueOf(yours, "Available to claim")).toHaveTextContent("60 SAFE")
      expect(valueOf(yours, "Cumulative earned")).toHaveTextContent("100 SAFE")
      expect(valueOf(yours, "Already claimed")).toHaveTextContent("40 SAFE")
    })

    it("shows a loading state", () => {
      mockUseRewards.mockReturnValue(rewards({ isLoading: true, proof: undefined }))
      renderPage()

      expect(within(section("Your rewards")).getByRole("status", { name: "Loading" })).toBeInTheDocument()
    })

    it("says the address never earned rewards when SEF has no file for it", () => {
      mockUseRewards.mockReturnValue(rewards({ proof: null, data: { claimable: 0n, totalClaimed: 0n, canClaim: false } }))
      renderPage()

      expect(within(section("Your rewards")).getByText(/has not earned rewards in Safenet Beta/)).toBeInTheDocument()
      expect(within(section("Actions")).getByText("This address has nothing to claim.")).toBeInTheDocument()
    })

    it("shows an error with a retry, scoped to the section", async () => {
      const refetch = vi.fn()
      mockUseRewards.mockReturnValue(rewards({ error: new Error("boom"), refetch, proof: undefined }))
      renderPage()

      const yours = section("Your rewards")
      expect(within(yours).getByRole("alert")).toHaveTextContent("Your rewards could not be loaded.")
      await userEvent.click(within(yours).getByRole("button", { name: "Retry" }))
      expect(refetch).toHaveBeenCalled()
      // The programme-wide sections do not depend on the wallet, so they still render.
      expect(valueOf(section("Programme"), "Allocated to date")).toHaveTextContent("1,000 SAFE")
    })

    it("shows the amount held pending compliance", () => {
      mockUseRewards.mockReturnValue(rewards({ proof: { ...PROOF, kycAmount: (25n * SAFE).toString() } }))
      renderPage()

      const yours = section("Your rewards")
      expect(valueOf(yours, "Held pending compliance")).toHaveTextContent("25 SAFE")
      expect(within(yours).getByText(/until its compliance checks/)).toBeInTheDocument()
      expect(within(yours).queryByRole("link")).not.toBeInTheDocument()
    })

    it("does not show a held amount when the file marks the address as checked", () => {
      mockUseRewards.mockReturnValue(rewards({ proof: { ...PROOF, kycAmount: (25n * SAFE).toString(), kyc: true } }))
      renderPage()

      expect(within(section("Your rewards")).queryByText("Held pending compliance")).not.toBeInTheDocument()
    })
  })

  describe("Actions", () => {
    it("opens Claim & Stake as the primary action when there is something to claim", async () => {
      renderPage()

      const primary = within(section("Actions")).getByRole("button", { name: "Claim & Stake" })
      expect(primary).toBeEnabled()
      await userEvent.click(primary)
      expect(screen.getByRole("dialog")).toHaveTextContent("Claim and stake dialog, mode claim")
    })

    it("offers to stake the balance once everything is claimed and SAFE sits in the wallet", async () => {
      mockUseRewards.mockReturnValue(rewards({ data: { claimable: 0n, canClaim: false } }))
      renderPage()

      const actions = section("Actions")
      expect(within(actions).queryByRole("button", { name: "Claim & Stake" })).not.toBeInTheDocument()
      expect(within(actions).getByText("The SAFE in your wallet earns nothing until you stake it.")).toBeInTheDocument()
      await userEvent.click(within(actions).getByRole("button", { name: "Stake your balance" }))
      expect(screen.getByRole("dialog")).toHaveTextContent("Claim and stake dialog, mode balance")
    })

    it.each<[string, () => void]>([
      ["the wallet is empty", () => mockBalance.mockReturnValue(0n)],
      ["the address never earned rewards", () => mockUseRewards.mockReturnValue(rewards({ proof: null }))],
      [
        "the root is stale",
        () => mockUseRewards.mockReturnValue(rewards({ data: { claimable: 0n, canClaim: false, rootStale: true } })),
      ],
      ["the wallet is on the wrong network", () => mockWrongNetwork.mockReturnValue(true)],
    ])("keeps Claim & Stake, disabled, with nothing to claim when %s", (_, arrange) => {
      mockUseRewards.mockReturnValue(rewards({ data: { claimable: 0n, canClaim: false } }))
      arrange()
      renderPage()

      const actions = section("Actions")
      expect(within(actions).queryByRole("button", { name: "Stake your balance" })).not.toBeInTheDocument()
      expect(within(actions).getByRole("button", { name: "Claim & Stake" })).toBeDisabled()
    })

    it("opens the claim dialog when there is something to claim", async () => {
      renderPage()

      const claim = within(section("Actions")).getByRole("button", { name: "Claim" })
      expect(claim).toBeEnabled()
      await userEvent.click(claim)
      expect(screen.getByRole("dialog")).toHaveTextContent("Claim dialog")
    })

    it.each<[string, () => void, string]>([
      ["disconnected", () => mockUseAccount.mockReturnValue({ isConnected: false }), "Connect a wallet to claim."],
      ["on the wrong network", () => mockWrongNetwork.mockReturnValue(true), "Switch to Ethereum to claim."],
      [
        "the root is stale",
        () => mockUseRewards.mockReturnValue(rewards({ data: { canClaim: false, rootStale: true } })),
        "Claiming opens when they match.",
      ],
      [
        "everything is claimed",
        () => mockUseRewards.mockReturnValue(rewards({ data: { claimable: 0n, canClaim: false } })),
        "Nothing to claim right now.",
      ],
      [
        "the reward data failed",
        () => mockUseRewards.mockReturnValue(rewards({ error: new Error("boom") })),
        "Claiming needs your reward data, which did not load.",
      ],
    ])("disables Claim and says why when %s", (_, arrange, reason) => {
      arrange()
      renderPage()

      const actions = section("Actions")
      expect(within(actions).getByRole("button", { name: "Claim" })).toBeDisabled()
      expect(within(actions).getByText(new RegExp(reason.replace(/\./g, "\\.")))).toBeInTheDocument()
    })
  })

  describe("Programme", () => {
    it("shows allocation, claims, unclaimed share, period end and epoch", () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date("2026-10-01T00:00:00Z"))
      renderPage()

      const prog = section("Programme")
      expect(valueOf(prog, "Allocated to date")).toHaveTextContent("1,000 SAFE")
      expect(valueOf(prog, "Claimed network-wide")).toHaveTextContent("700 SAFE")
      expect(valueOf(prog, "Unclaimed share")).toHaveTextContent("30.00%")
      expect(valueOf(prog, "Last computed period ended")).toHaveTextContent("Tue 22 Sep 2026, 00:00 UTC")
      expect(valueOf(prog, "Last computed period ended")).toHaveTextContent("Periods run two weeks")
      expect(valueOf(prog, "Epoch")).toHaveTextContent("3")
      expect(within(prog).queryByText(/next/i)).not.toBeInTheDocument()
    })

    it("says no later period was published once a full period has passed", () => {
      vi.useFakeTimers({ toFake: ["Date"] })
      vi.setSystemTime(new Date("2026-10-07T00:00:00Z"))
      renderPage()

      expect(valueOf(section("Programme"), "Last computed period ended")).toHaveTextContent(
        "No period ending after this date has been published.",
      )
    })

    it("shows a loading state while SEF's file loads", () => {
      mockUseProgramme.mockReturnValue(programme({ latest: { data: undefined, error: null, refetch: vi.fn() } }))
      renderPage()

      expect(within(section("Programme")).getByRole("status", { name: "Loading" })).toBeInTheDocument()
    })

    it("shows an error when SEF's file fails, and Verifiability says so too", async () => {
      const refetch = vi.fn()
      mockUseProgramme.mockReturnValue(
        programme({ latest: { data: undefined, error: new Error("404"), refetch }, totals: undefined, rootMatches: undefined }),
      )
      renderPage()

      const prog = section("Programme")
      expect(within(prog).getByRole("alert")).toHaveTextContent("SEF's published rewards file could not be loaded.")
      await userEvent.click(within(prog).getByRole("button", { name: "Retry" }))
      expect(refetch).toHaveBeenCalled()
      expect(within(section("Verifiability")).getByText("Not compared yet")).toBeInTheDocument()
    })

    it("marks the on-chain figures unavailable when the balance read fails", () => {
      mockUseProgramme.mockReturnValue(
        programme({ dropBalance: { data: undefined, error: new Error("rpc"), refetch: vi.fn() }, totals: undefined }),
      )
      renderPage()

      const prog = section("Programme")
      expect(valueOf(prog, "Claimed network-wide")).toHaveTextContent("Unavailable")
      expect(valueOf(prog, "Allocated to date")).toHaveTextContent("1,000 SAFE")
      expect(within(prog).getByRole("alert")).toHaveTextContent("The MerkleDrop contract could not be read from Ethereum.")
    })

    it("waits for the on-chain root before showing derived figures", () => {
      mockUseProgramme.mockReturnValue(
        programme({ onChainRoot: { data: undefined, error: null, refetch: vi.fn() }, rootMatches: undefined, totals: undefined }),
      )
      renderPage()

      expect(valueOf(section("Programme"), "Claimed network-wide")).not.toHaveTextContent("Not derivable")
    })

    it("refuses to derive claims when the contract holds more than the allocation", () => {
      mockUseProgramme.mockReturnValue(
        programme({ totals: { allocated: 1000n * SAFE, unclaimed: 1200n * SAFE, claimed: undefined, unclaimedPercent: undefined } }),
      )
      renderPage()

      const prog = section("Programme")
      expect(valueOf(prog, "Claimed network-wide")).toHaveTextContent("Not derivable")
      expect(within(prog).getByText(/holds more SAFE than the published allocation/)).toBeInTheDocument()
    })
  })

  describe("Verifiability", () => {
    it("links the MerkleDrop on the explorer and shows both roots and the balance", () => {
      renderPage()

      const ver = section("Verifiability")
      expect(within(ver).getByText(merkleDrop!)).toBeInTheDocument()
      expect(within(ver).getByRole("link", { name: /View on/ })).toHaveAttribute(
        "href",
        expect.stringContaining(`/address/${merkleDrop}`),
      )
      expect(within(ver).getAllByText(ROOT_A)).toHaveLength(2)
      expect(within(ver).getByText("Match")).toBeInTheDocument()
      expect(within(ver).getByText("300 SAFE")).toBeInTheDocument()
    })

    it("flags a root that differs, and Programme derives no claims across the two roots", () => {
      mockUseProgramme.mockReturnValue(
        programme({ onChainRoot: { data: ROOT_B, error: null, refetch: vi.fn() }, rootMatches: false, totals: undefined }),
      )
      renderPage()

      const ver = section("Verifiability")
      expect(within(ver).getByText("Differs")).toBeInTheDocument()
      expect(within(ver).getByText(/Claims built from the published files fail/)).toBeInTheDocument()

      const prog = section("Programme")
      expect(valueOf(prog, "Claimed network-wide")).toHaveTextContent("Not derivable")
      expect(valueOf(prog, "Unclaimed share")).toHaveTextContent("Not derivable")
      expect(valueOf(prog, "Allocated to date")).toHaveTextContent("1,000 SAFE")
      expect(within(prog).getByText(/root on chain differs from the one SEF published/)).toBeInTheDocument()
    })

    it("shows a section error when the contract cannot be read", async () => {
      const refetchRoot = vi.fn()
      mockUseProgramme.mockReturnValue(
        programme({ onChainRoot: { data: undefined, error: new Error("rpc"), refetch: refetchRoot }, rootMatches: undefined }),
      )
      renderPage()

      const ver = section("Verifiability")
      expect(within(ver).getByRole("alert")).toHaveTextContent("MerkleDrop contract could not be read")
      await userEvent.click(within(ver).getByRole("button", { name: "Retry" }))
      expect(refetchRoot).toHaveBeenCalled()
    })

    it("says so when no rewards contract is configured", () => {
      mockUseProgramme.mockReturnValue(programme({ merkleDrop: undefined }))
      renderPage()

      expect(within(section("Verifiability")).getByText(/No rewards contract is configured/)).toBeInTheDocument()
    })
  })
})
