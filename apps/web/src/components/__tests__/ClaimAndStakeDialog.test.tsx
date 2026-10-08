import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { encodeErrorResult, type Hex } from "viem"
import { merkleDropAbi } from "@/abi/merkleDropAbi"
import type { useRewards } from "@/hooks/useRewards"
import type { RewardProof } from "@/hooks/useRewardProof"
import { AMOUNTS, MOCK_VALIDATORS, TEST_ACCOUNTS } from "@/__tests__/test-data"
import { ClaimAndStakeDialog, type ClaimAndStakeMode } from "../rewards/ClaimAndStakeDialog"

const SAFE = 10n ** 18n
const ROOT_A = `0x${"ab".repeat(32)}` as Hex
const ROOT_B = `0x${"cd".repeat(32)}` as Hex
const PROOF: RewardProof = { cumulativeAmount: (100n * SAFE).toString(), merkleRoot: ROOT_A, proof: [`0x${"11".repeat(32)}`] }
const GNOSIS = `${MOCK_VALIDATORS[0].label} · ${MOCK_VALIDATORS[0].commission}% commission`

const m = vi.hoisted(() => ({
  claim: vi.fn(),
  claimReset: vi.fn(),
  claimState: {} as Record<string, unknown>,
  stake: vi.fn(),
  resetStake: vi.fn(),
  stakeState: { isSuccess: false, txHash: undefined as Hex | undefined },
  batchApproveAndStake: vi.fn(),
  batchState: { supportsBatching: false },
  approval: { needsApproval: false },
  toast: vi.fn(),
  balance: 0n as bigint | undefined,
  balanceOptions: vi.fn(),
}))

vi.mock("wagmi", () => ({ useAccount: () => ({ isConnected: true, address: TEST_ACCOUNTS.user }) }))
vi.mock("@/hooks/useWrongNetwork", () => ({ useWrongNetwork: () => false }))
vi.mock("@/hooks/useClaimStep", () => ({
  useClaimStep: () => ({
    claim: m.claim,
    reset: m.claimReset,
    supportsBatching: false,
    isSigningTx: false,
    isConfirmingTx: false,
    isAwaitingExecution: false,
    isSafeQueued: false,
    isSuccess: false,
    error: null,
    txHash: undefined,
    claimedAmount: undefined,
    ...m.claimState,
  }),
}))
vi.mock("@/hooks/useTokenBalance", () => ({
  useTokenBalance: (options?: { refetchInterval?: number }) => {
    m.balanceOptions(options)
    return { data: m.balance }
  },
}))
vi.mock("@/hooks/useValidators", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useValidators")>()),
  useValidators: () => ({ data: MOCK_VALIDATORS, isLoading: false, error: null }),
}))
vi.mock("@/hooks/useApprovalFlow", () => ({
  useApprovalFlow: () => ({
    approvalType: null,
    isApprovalPending: false,
    isSigningApproval: false,
    isConfirmingApproval: false,
    approveExact: vi.fn(),
    approveUnlimited: vi.fn(),
    resetApprovalFlow: vi.fn(),
    ...m.approval,
  }),
}))
vi.mock("@/hooks/useStakingWrites", () => ({
  useStake: () => ({
    stake: m.stake,
    isSigningTx: false,
    isConfirmingTx: false,
    isSafeQueued: false,
    error: null,
    reset: m.resetStake,
    ...m.stakeState,
  }),
  useBatchStake: () => ({
    batchApproveAndStake: m.batchApproveAndStake,
    isSigningTx: false,
    isConfirmingTx: false,
    isSuccess: false,
    isReverted: false,
    error: null,
    reset: vi.fn(),
    txHash: undefined,
    ...m.batchState,
  }),
}))
vi.mock("@/hooks/useStakingReads", () => ({ useWithdrawDelay: () => ({ data: AMOUNTS.withdrawDelay }) }))
vi.mock("@/hooks/useToast", () => ({ useToast: () => ({ toast: m.toast }) }))
vi.mock("@/hooks/useGasEstimate", () => ({ useGasEstimate: () => ({ estimatedCost: null, isLoading: false }) }))

type Rewards = ReturnType<typeof useRewards>

function rewards(overrides: Partial<Rewards> = {}): Rewards {
  return {
    data: { claimable: 60n * SAFE, totalClaimed: 40n * SAFE, canClaim: true, rootStale: false },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    reload: vi.fn(),
    proof: PROOF,
    proofSource: undefined,
    hasMerkleDrop: true,
    ...overrides,
  }
}

function renderDialog({
  mode = "claim",
  onOpenChange = vi.fn(),
  rewardsData = rewards(),
}: { mode?: ClaimAndStakeMode; onOpenChange?: (open: boolean) => void; rewardsData?: Rewards } = {}) {
  const ui = (open = true) => (
    <TooltipProvider>
      <ClaimAndStakeDialog open={open} onOpenChange={onOpenChange} mode={mode} rewards={rewardsData} />
    </TooltipProvider>
  )
  const view = render(ui())
  return { ...view, onOpenChange, rerenderOpen: () => view.rerender(ui()) }
}

const rootUpdated = () =>
  new Error(`Execution reverted: custom error ${encodeErrorResult({ abi: merkleDropAbi, errorName: "MerkleRootWasUpdated" })}`)

/** The claim has confirmed and paid `amount`. */
function claimed(amount: bigint | undefined) {
  m.claimState = { isSuccess: true, claimedAmount: amount, txHash: `0x${"c1".repeat(32)}` }
}

describe("ClaimAndStakeDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.claimState = {}
    m.stakeState = { isSuccess: false, txHash: undefined }
    m.batchState = { supportsBatching: false }
    m.approval = { needsApproval: false }
    m.balance = AMOUNTS.userBalance
  })

  describe("claim step", () => {
    it("shows what is claimable and claims with the proof", async () => {
      renderDialog()

      expect(screen.getByRole("heading", { name: "Claim & Stake" })).toBeInTheDocument()
      expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Claim")
      await userEvent.click(screen.getByRole("button", { name: "Claim 60 SAFE" }))

      expect(m.claim).toHaveBeenCalledWith({
        cumulativeAmount: 100n * SAFE,
        merkleRoot: ROOT_A,
        proof: PROOF.proof,
      })
    })

    it("says when the claim is waiting for the Safe to execute it", () => {
      m.claimState = { isConfirmingTx: true, isAwaitingExecution: true }
      renderDialog()

      expect(screen.getByRole("button", { name: /Waiting for the Safe to execute/ })).toBeDisabled()
    })

    it("explains a root that moved, then reloads the proof and claims against the new root", async () => {
      m.claimState = { error: rootUpdated() }
      const fresh = { ...PROOF, cumulativeAmount: (150n * SAFE).toString(), merkleRoot: ROOT_B }
      const data = rewards({ reload: vi.fn().mockResolvedValue({ proof: fresh, root: ROOT_B, error: null }) })
      renderDialog({ rewardsData: data })

      expect(screen.getByRole("alert")).toHaveTextContent("The rewards root changed on chain")
      expect(screen.queryByRole("button", { name: /^Claim/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole("button", { name: "Reload proof and retry" }))

      expect(m.claimReset).toHaveBeenCalled()
      expect(data.reload).toHaveBeenCalled()
      expect(m.claim).toHaveBeenCalledWith({ cumulativeAmount: 150n * SAFE, merkleRoot: ROOT_B, proof: fresh.proof })
    })

    it("does not claim when the reloaded proof is still for the old root", async () => {
      m.claimState = { error: rootUpdated() }
      const data = rewards({ reload: vi.fn().mockResolvedValue({ proof: PROOF, root: ROOT_B, error: null }) })
      renderDialog({ rewardsData: data })

      await userEvent.click(screen.getByRole("button", { name: "Reload proof and retry" }))

      expect(m.claim).not.toHaveBeenCalled()
      expect(m.claimReset).not.toHaveBeenCalled()
      expect(await screen.findByText(/SEF has not published proofs for the new root yet/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reload proof and retry" })).toBeEnabled()
    })

    it("keeps the reload action when the reload itself fails", async () => {
      m.claimState = { error: rootUpdated() }
      const data = rewards({ reload: vi.fn().mockResolvedValue({ proof: undefined, root: undefined, error: new Error("503") }) })
      renderDialog({ rewardsData: data })

      await userEvent.click(screen.getByRole("button", { name: "Reload proof and retry" }))

      expect(m.claim).not.toHaveBeenCalled()
      expect(m.claimReset).not.toHaveBeenCalled()
      expect(await screen.findByText(/could not be loaded again/)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Reload proof and retry" })).toBeEnabled()
    })

    it("shows other claim errors in plain words, with the claim still available", () => {
      m.claimState = { error: new Error("User rejected the request.") }
      renderDialog()

      expect(screen.getByRole("alert")).toHaveTextContent("Transaction rejected")
      expect(screen.getByRole("button", { name: "Claim 60 SAFE" })).toBeEnabled()
    })
  })

  describe("stake step", () => {
    it("pre-fills the amount the claim paid and needs a validator before staking", async () => {
      claimed(60n * SAFE)
      renderDialog()

      expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Stake")
      expect(screen.getByText(/Claimed 60 SAFE\. It is in your wallet now\./)).toBeInTheDocument()
      expect(screen.getByLabelText("Amount")).toHaveValue("60")
      expect(screen.getByText("Claimed: 60")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled()

      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      await userEvent.click(screen.getByRole("button", { name: "Stake" }))

      expect(m.stake).toHaveBeenCalledWith(TEST_ACCOUNTS.validator1, 60n * SAFE)
    })

    it("says what stays in the wallet when the amount is reduced, and refuses more than was claimed", async () => {
      claimed(60n * SAFE)
      renderDialog()
      const amount = screen.getByLabelText("Amount")

      await userEvent.clear(amount)
      await userEvent.type(amount, "45")
      expect(screen.getByText("15 SAFE stays in your wallet, not staked.")).toBeInTheDocument()

      await userEvent.clear(amount)
      await userEvent.type(amount, "61")
      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      expect(screen.getByText("Claim & Stake stakes up to the 60 SAFE you claimed.")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled()
    })

    it("batches approve and stake in a wallet that supports it", async () => {
      claimed(60n * SAFE)
      m.batchState = { supportsBatching: true }
      m.approval = { needsApproval: true }
      renderDialog()

      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      expect(screen.queryByRole("button", { name: /Approve/ })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole("button", { name: "Stake" }))

      expect(m.batchApproveAndStake).toHaveBeenCalledWith(TEST_ACCOUNTS.validator1, 60n * SAFE)
    })

    it("does not lock the form on a balance read from before the claim, and polls until it catches up", async () => {
      claimed(60n * SAFE)
      // A node that has not seen the claim's block: the wallet held nothing before claiming.
      m.balance = 0n
      const view = renderDialog()

      expect(m.balanceOptions).toHaveBeenCalledWith({ refetchInterval: 4_000 })
      const amount = screen.getByLabelText("Amount")
      expect(amount).toBeEnabled()
      expect(amount).toHaveValue("60")
      expect(screen.queryByText(/do not have enough SAFE/)).not.toBeInTheDocument()
      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      expect(screen.getByRole("button", { name: "Stake" })).toBeEnabled()

      // The next poll reaches a node that has.
      m.balance = 60n * SAFE
      view.rerenderOpen()
      expect(screen.getByLabelText("Amount")).toBeEnabled()
      expect(screen.getByRole("button", { name: "Stake" })).toBeEnabled()
    })

    it("drops that floor once a read includes the claim, so a later lower balance is believed", async () => {
      claimed(60n * SAFE)
      m.balance = 60n * SAFE
      const view = renderDialog()
      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      expect(screen.getByRole("button", { name: "Stake" })).toBeEnabled()

      // 50 SAFE leave the wallet elsewhere.
      m.balance = 10n * SAFE
      view.rerenderOpen()

      expect(screen.getByText("You do not have enough SAFE to stake this amount.")).toBeInTheDocument()
      expect(screen.getByRole("button", { name: "Stake" })).toBeDisabled()
    })

    it("asks for the amount when the receipt did not show it", () => {
      claimed(undefined)
      renderDialog()

      expect(screen.getByText(/could not be read from the transaction receipt/)).toBeInTheDocument()
      expect(screen.getByLabelText("Amount")).toHaveValue("")
    })

    it("ends on what was staked and what stays in the wallet", async () => {
      claimed(60n * SAFE)
      const view = renderDialog()
      const amount = screen.getByLabelText("Amount")
      await userEvent.clear(amount)
      await userEvent.type(amount, "50")
      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      await userEvent.click(screen.getByRole("button", { name: "Stake" }))
      // Edited while the stake confirms: the result still reports what was sent.
      await userEvent.type(amount, "5")

      m.stakeState = { isSuccess: true, txHash: `0x${"5a".repeat(32)}` }
      view.rerenderOpen()

      expect(screen.getByRole("status")).toHaveTextContent("Staked 50 SAFE with Gnosis. 10 SAFE stays in your wallet.")
      expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("Done")
    })
  })

  describe("closing", () => {
    it("after a claim, says plainly that the SAFE is in the wallet and not staked, then closes", async () => {
      claimed(60n * SAFE)
      const { onOpenChange } = renderDialog()

      await userEvent.keyboard("{Escape}")
      expect(onOpenChange).not.toHaveBeenCalled()
      expect(screen.getByRole("alert")).toHaveTextContent("Your 60 SAFE is in your wallet and is not staked.")

      await userEvent.click(screen.getByRole("button", { name: "Close anyway" }))
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(m.claimReset).toHaveBeenCalled()
    })

    it("can go back to staking from that notice", async () => {
      claimed(60n * SAFE)
      renderDialog()

      await userEvent.keyboard("{Escape}")
      await userEvent.click(screen.getByRole("button", { name: "Stake now" }))

      expect(screen.getByLabelText("Amount")).toHaveValue("60")
    })

    it("closes at once before anything was claimed", async () => {
      const { onOpenChange } = renderDialog()

      await userEvent.keyboard("{Escape}")
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it("clears a claim that confirmed while closed, once reported, so the next opening follows its button", () => {
      claimed(60n * SAFE)
      const view = render(
        <TooltipProvider>
          <ClaimAndStakeDialog open={false} onOpenChange={vi.fn()} mode="balance" rewards={rewards()} />
        </TooltipProvider>,
      )

      expect(m.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Rewards claimed" }))
      expect(m.claimReset).toHaveBeenCalled()
      view.unmount()
    })

    it("names the amount and validator sent when a stake confirms after the dialog closed", async () => {
      claimed(60n * SAFE)
      const onOpenChange = vi.fn()
      const ui = (open: boolean) => (
        <TooltipProvider>
          <ClaimAndStakeDialog open={open} onOpenChange={onOpenChange} mode="claim" rewards={rewards()} />
        </TooltipProvider>
      )
      const view = render(ui(true))
      const amount = screen.getByLabelText("Amount")
      await userEvent.clear(amount)
      await userEvent.type(amount, "50")
      await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
      await userEvent.click(screen.getByRole("button", { name: "Stake" }))

      // Closed while the stake confirms: the dialog drops its validator and amount.
      m.stakeState = { isSuccess: false, isConfirmingTx: true, txHash: undefined } as typeof m.stakeState
      view.rerender(ui(true))
      await userEvent.keyboard("{Escape}")
      expect(onOpenChange).toHaveBeenCalledWith(false)
      view.rerender(ui(false))

      m.stakeState = { isSuccess: true, txHash: `0x${"5a".repeat(32)}` }
      view.rerender(ui(false))

      expect(m.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Delegation successful", description: "Staked 50 SAFE to 0x1234...5678" }),
      )
    })

    it("keeps a claim that is still confirming, so it reports when it lands", async () => {
      m.claimState = { isConfirmingTx: true }
      const { onOpenChange } = renderDialog()

      await userEvent.keyboard("{Escape}")
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(m.claimReset).not.toHaveBeenCalled()
    })
  })

  it("stakes the wallet balance when opened with nothing to claim", async () => {
    renderDialog({ mode: "balance" })

    expect(screen.getByRole("heading", { name: "Stake your balance" })).toBeInTheDocument()
    expect(screen.queryByText("Claim")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Amount")).toHaveValue("1000")

    await userEvent.selectOptions(screen.getByLabelText("Validator"), GNOSIS)
    await userEvent.click(screen.getByRole("button", { name: "Stake" }))
    expect(m.stake).toHaveBeenCalledWith(TEST_ACCOUNTS.validator1, AMOUNTS.userBalance)
  })

  it("tells the user once the claim confirms, with the amount", () => {
    claimed(60n * SAFE)
    renderDialog()

    expect(m.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rewards claimed",
        description: "60 SAFE is in your wallet. It earns nothing until you stake it.",
      }),
    )
  })
})
