import { useTranslation } from "react-i18next"
import { useEffect, useState } from "react"
import type { Address } from "viem"
import { useAccount } from "wagmi"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { TxButton } from "@/components/ui/TxButton"
import { Stepper } from "@/components/ui/stepper"
import { StakeForm } from "@/components/staking/StakeForm"
import { ValidatorSelect } from "@/components/staking/ValidatorSelect"
import { merkleDropAbi } from "@/abi/merkleDropAbi"
import { useClaimStep } from "@/hooks/useClaimStep"
import { useStakeForm, type Staked } from "@/hooks/useStakeForm"
import { useTokenBalance } from "@/hooks/useTokenBalance"
import { useValidators, findValidator } from "@/hooks/useValidators"
import { useWrongNetwork } from "@/hooks/useWrongNetwork"
import { useToast } from "@/hooks/useToast"
import { sameRoot } from "@/hooks/useProgrammeRewards"
import type { useRewards } from "@/hooks/useRewards"
import { formatContractError, revertedErrorName } from "@/lib/errorFormat"
import { formatTokenAmount, truncateAddress } from "@/lib/format"

/** "claim" claims, then stakes what arrived. "balance" stakes SAFE already in the wallet. */
export type ClaimAndStakeMode = "claim" | "balance"

interface ClaimAndStakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: ClaimAndStakeMode
  rewards: ReturnType<typeof useRewards>
}

/**
 * Claim & Stake: claim the MerkleDrop rewards, then stake exactly what arrived, in two
 * transactions. MerkleDrop rewards do not compound, so without this they sit in the wallet.
 *
 * The stake step is the same form and the same transactions as DelegateDialog: approve and
 * stake, batched into one in a wallet that supports it, and no approval when the allowance
 * already covers the amount.
 */
export function ClaimAndStakeDialog({ open, onOpenChange, mode, rewards }: ClaimAndStakeDialogProps) {
  const { t } = useTranslation()
  const { isConnected } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const { toast } = useToast()
  const { data: validators } = useValidators()
  const { data: balance } = useTokenBalance()
  const claim = useClaimStep()

  const [validator, setValidator] = useState<Address | undefined>()
  const [staked, setStaked] = useState<Staked | undefined>()
  const [leaving, setLeaving] = useState(false)
  const [reloading, setReloading] = useState(false)
  const [reloadNote, setReloadNote] = useState<string | null>(null)

  const claimBusy = claim.isSigningTx || claim.isConfirmingTx
  // A claim in flight or confirmed keeps the dialog in the restake flow, whichever button opened it.
  const restaking = mode === "claim" || claimBusy || claim.isSuccess
  const claimedAmount = claim.claimedAmount
  const stage = staked ? "done" : !restaking || claim.isSuccess ? "stake" : "claim"

  const walletBalance = typeof balance === "bigint" ? balance : undefined
  const form = useStakeForm({
    validator,
    active: open && stage === "stake",
    initialAmount: restaking ? claimedAmount : walletBalance,
    maxAmount: restaking ? claimedAmount : undefined,
    // A stake that confirms after the dialog closed still toasts, but must not reopen on "Done".
    onStaked: open ? setStaked : undefined,
    // Right after a claim, a balance read can come from a node behind the claim's block. Poll it,
    // and count the claimed SAFE as available meanwhile.
    availableAtLeast: restaking && claim.isSuccess ? claimedAmount : undefined,
    pollBalance: true,
  })

  useEffect(() => {
    if (!claim.isSuccess) return
    toast({
      variant: "success",
      title: t("dashboard.rewardsClaimed", "Rewards claimed"),
      description:
        claimedAmount !== undefined
          ? t("rewards.claimedInWallet", "{{amount}} SAFE is in your wallet. It earns nothing until you stake it.", { amount: formatTokenAmount(claimedAmount) })
          : t("rewards.yourRewardsAreInYourWalletTheyEarn", "Your rewards are in your wallet. They earn nothing until you stake them."),
      txHash: claim.txHash,
    })
  }, [claim.isSuccess, claimedAmount, claim.txHash, toast, t])

  // A claim that confirms after the dialog closed has been reported by the toast above. Clear it,
  // so the next opening follows the button pressed, not the old claim.
  const { reset: resetClaim } = claim
  useEffect(() => {
    if (!open && claim.isSuccess) resetClaim()
  }, [open, claim.isSuccess, resetClaim])

  const claimError = claim.error
  const rootUpdated = claimError ? revertedErrorName(claimError, merkleDropAbi) === "MerkleRootWasUpdated" : false
  const unstakedClaim = restaking && claim.isSuccess && !staked && !form.isBusy

  function close() {
    setLeaving(false)
    setStaked(undefined)
    setValidator(undefined)
    setReloadNote(null)
    // A claim still in flight keeps its state, so it reports when it confirms.
    if (!claimBusy) claim.reset()
    onOpenChange(false)
  }

  function handleOpenChange(next: boolean) {
    if (next) return onOpenChange(true)
    // Closing with a claim confirmed but not staked: say plainly where the SAFE is, once.
    if (unstakedClaim && !leaving) return setLeaving(true)
    close()
  }

  function submitClaim() {
    const proof = rewards.proof
    if (!proof?.proof) return
    setReloadNote(null)
    void claim.claim({
      cumulativeAmount: BigInt(proof.cumulativeAmount),
      merkleRoot: proof.merkleRoot,
      proof: proof.proof,
    })
  }

  // The claim error stays until the fresh proof passes, so a failed reload keeps this action.
  async function reloadAndRetry() {
    setReloadNote(null)
    setReloading(true)
    try {
      const { proof, root, error } = await rewards.reload()
      if (error) {
        setReloadNote(t("rewards.theProofOrTheOnChainRootCould", "The proof or the on-chain root could not be loaded again. Try again."))
        return
      }
      if (!proof?.proof) {
        setReloadNote(t("rewards.sefSRewardFileForThisAddressCould", "SEF's reward file for this address could not be loaded again. Try again later."))
        return
      }
      if (sameRoot(root, proof.merkleRoot) === false) {
        setReloadNote(
          t("rewards.sefHasNotPublishedProofsForTheNew", "SEF has not published proofs for the new root yet. Claiming opens when they match. Try again later."),
        )
        return
      }
      claim.reset()
      void claim.claim({
        cumulativeAmount: BigInt(proof.cumulativeAmount),
        merkleRoot: proof.merkleRoot,
        proof: proof.proof,
      })
    } finally {
      setReloading(false)
    }
  }

  const steps = restaking
    ? [t("rewards.claim2", "Claim"), t("validators.stake", "Stake"), t("rewards.done2", "Done")]
    : [t("validators.stake", "Stake"), t("rewards.done2", "Done")]
  const current = stage === "claim" ? 0 : stage === "stake" ? (restaking ? 1 : 0) : steps.length - 1

  const rest =
    restaking && claimedAmount !== undefined && form.parsedAmount > 0n && form.parsedAmount < claimedAmount
      ? claimedAmount - form.parsedAmount
      : 0n
  const stakedRest =
    staked && restaking && claimedAmount !== undefined && staked.amount < claimedAmount
      ? claimedAmount - staked.amount
      : 0n
  const stakedWith = staked ? (findValidator(validators, staked.validator)?.label ?? truncateAddress(staked.validator)) : ""

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{restaking ? t("rewards.claimStake", "Claim & Stake") : t("rewards.stakeYourBalance", "Stake your balance")}</DialogTitle>
          <DialogDescription>
            {restaking
              ? t("rewards.claimYourRewardsThenStakeThemWithA", "Claim your rewards, then stake them with a validator. A wallet that cannot batch also asks to approve before staking.")
              : t("rewards.stakeSafeThatIsAlreadyInYourWallet", "Stake SAFE that is already in your wallet.")}
          </DialogDescription>
        </DialogHeader>

        <Stepper steps={steps} current={current} />

        {!isConnected && <p className="text-sm text-destructive">{t("rewards.connectAWalletToContinue", "Connect a wallet to continue.")}</p>}
        {isConnected && wrongNetwork && (
          <p className="text-sm text-destructive">{t("rewards.yourWalletIsOnAnotherNetworkSwitchTo", "Your wallet is on another network. Switch to Ethereum to continue.")}</p>
        )}

        {stage === "claim" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-4">
              <span className="text-sm text-muted-foreground">{t("dashboard.claimableSafe", "Claimable SAFE")}</span>
              <span className="font-mono text-lg font-medium tabular-nums">
                {formatTokenAmount(rewards.data.claimable)}
              </span>
            </div>

            {claimError && (
              <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm">
                {rootUpdated ? t("rewards.rootUpdated", "The rewards root changed on chain after your proof was loaded, so the contract refused the claim. Reload the proof to claim against the new root.") : formatContractError(claimError)}
              </p>
            )}
            {reloadNote && (
              <p role="status" className="text-sm text-muted-foreground">
                {reloadNote}
              </p>
            )}
            {claim.isSafeQueued && (
              <p role="status" className="text-sm text-muted-foreground">{t("rewards.theClaimIsQueuedInYourSafeOnce", "The claim is queued in your Safe. Once it executes, come back and use Stake your balance.")}</p>
            )}

            {rootUpdated ? (
              <TxButton
                className="w-full"
                isSigningTx={reloading}
                isConfirmingTx={false}
                signingLabel={t("rewards.reloadingProof", "Reloading proof…")}
                onClick={() => void reloadAndRetry()}
              >{t("rewards.reloadProofAndRetry", "Reload proof and retry")}</TxButton>
            ) : (
              <TxButton
                className="w-full"
                isSigningTx={reloading || claim.isSigningTx}
                isConfirmingTx={claim.isConfirmingTx}
                confirmingLabel={claim.isAwaitingExecution ? t("rewards.waitingForTheSafeToExecute", "Waiting for the Safe to execute…") : undefined}
                onClick={submitClaim}
                disabled={!rewards.data.canClaim || !rewards.proof?.proof}
              >{t("rewards.claimSafe", "Claim {{amount}} SAFE", { amount: formatTokenAmount(rewards.data.claimable) })}</TxButton>
            )}
          </div>
        )}

        {stage === "stake" && leaving && (
          <div role="alert" className="space-y-3 rounded-md border border-warning/60 p-3 text-sm">
            <p>
              {claimedAmount !== undefined
                ? t("rewards.unstakedAmount", "Your {{amount}} SAFE is in your wallet and is not staked. It earns no rewards until you stake it.", { amount: formatTokenAmount(claimedAmount) })
                : t("rewards.unstakedClaim", "Your claimed SAFE is in your wallet and is not staked. It earns no rewards until you stake it.")}
            </p>
            <p>{t("rewards.toStakeItLaterComeBackToThis", "To stake it later, come back to this page and use Stake your balance.")}</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setLeaving(false)}>{t("rewards.stakeNow", "Stake now")}</Button>
              <Button variant="outline" onClick={close}>{t("rewards.closeAnyway", "Close anyway")}</Button>
            </div>
          </div>
        )}

        {stage === "stake" && !leaving && (
          <>
            {restaking && (
              <p className="text-sm text-muted-foreground">
                {claimedAmount !== undefined
                  ? t("rewards.claimedChooseValidator", "Claimed {{amount}} SAFE. It is in your wallet now. Choose a validator to stake it with.", { amount: formatTokenAmount(claimedAmount) })
                  : t("rewards.yourRewardsAreClaimedAndInYourWallet", "Your rewards are claimed and in your wallet. Their amount could not be read from the transaction receipt, so enter the amount to stake.")}
              </p>
            )}
            <ValidatorSelect value={validator} onChange={setValidator} disabled={form.isBusy} />
            <StakeForm
              form={form}
              maxLabel={t("rewards.claimed", "Claimed")}
              aboveMaxMessage={
                claimedAmount !== undefined
                  ? t("rewards.claimedCeiling", "Claim & Stake stakes up to the {{amount}} SAFE you claimed.", { amount: formatTokenAmount(claimedAmount) })
                  : undefined
              }
              notes={
                rest > 0n && (
                  <p className="text-sm text-muted-foreground">{t("rewards.safeStaysInYourWalletNotStaked", "{{amount}} SAFE stays in your wallet, not staked.", { amount: formatTokenAmount(rest) })}</p>
                )
              }
            />
          </>
        )}

        {stage === "done" && staked && (
          <div className="space-y-4">
            <p role="status" className="text-sm">
              {t("rewards.stakedWith", "Staked {{amount}} SAFE with {{validator}}.", { amount: formatTokenAmount(staked.amount), validator: stakedWith })}
              {stakedRest > 0n && t("rewards.remainingInWallet", " {{amount}} SAFE stays in your wallet.", { amount: formatTokenAmount(stakedRest) })}
            </p>
            <Button className="w-full" onClick={close}>{t("rewards.close", "Close")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
