import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { TxButton } from "@/components/ui/TxButton"
import { Term } from "@/components/ui/term"
import { useValidators, findValidator } from "@/hooks/useValidators"
import type { StakeFormState } from "@/hooks/useStakeForm"
import { unstakingPeriodText } from "@/lib/glossary"
import { formatTokenAmount, truncateAddress } from "@/lib/format"
import { PARTICIPATION_RULE } from "@/lib/programme"

interface StakeReviewProps {
  form: StakeFormState
}

interface Scenario {
  question: string
  answer: ReactNode
}

/**
 * "What happens if…": the step between Stake and the wallet's confirmation. Each answer
 * restates SEF's staking documentation (Lock-up and withdrawals, Rewards, Risks), and the
 * figures come from the staking contract and core, never from this file.
 */
export function StakeReview({ form }: StakeReviewProps) {
  const { data: validators } = useValidators()
  const { validator, parsedAmount, withdrawDelay, isBatchFlow, stake, batch, cancelReview, isBusy } = form
  const period = unstakingPeriodText(withdrawDelay)
  const validatorName = validator ? (findValidator(validators, validator)?.label ?? truncateAddress(validator)) : "the validator"

  const scenarios: Scenario[] = [
    {
      question: "I want my SAFE back?",
      answer: (
        <>
          Undelegate at any time. The SAFE then waits in the staking contract for{" "}
          <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay}>
            {period}
          </Term>
          , earns no rewards and cannot be moved. A second transaction claims it to your wallet.
        </>
      ),
    },
    {
      question: "I want to move to another validator?",
      answer:
        "There is no direct switch. Undelegate, wait out the unstaking period, claim, then delegate again. Nothing is earned in between.",
    },
    {
      question: "this validator's participation drops?",
      answer: `${PARTICIPATION_RULE} Your SAFE stays staked either way.`,
    },
    {
      question: "something goes wrong?",
      answer: (
        <>
          Staked SAFE is not currently subject to <Term term="slashing">slashing</Term>: poor performance costs
          rewards, not the SAFE itself. The staking contract cannot be upgraded and was audited, but like any
          contract it can have defects.
        </>
      ),
    },
    {
      question: "rewards are lower than I expect?",
      answer: (
        <>
          <Term term="rewards">Rewards</Term> are not guaranteed. They depend on the validator&apos;s participation
          and commission, on the SAFE staked across the network, and on how long yours stays staked. They are not
          added to your stake: you claim them.
        </>
      ),
    },
  ]

  const confirm = () => {
    if (!validator) return
    if (isBatchFlow) batch.batchApproveAndStake(validator, parsedAmount)
    else stake.stake(validator, parsedAmount)
  }
  const signing = isBatchFlow ? batch.isSigningTx : stake.isSigningTx
  const confirming = isBatchFlow ? batch.isConfirmingTx : stake.isConfirmingTx

  return (
    <section aria-labelledby="stake-review-title" className="space-y-4">
      <div className="space-y-1">
        <h3 id="stake-review-title" className="text-base font-semibold">
          Before you stake {formatTokenAmount(parsedAmount)} SAFE with {validatorName}
        </h3>
        <p className="text-sm text-muted-foreground">What happens if…</p>
      </div>
      <dl className="space-y-3 text-sm">
        {scenarios.map(({ question, answer }) => (
          <div key={question}>
            <dt className="font-medium">…{question}</dt>
            <dd className="text-muted-foreground">{answer}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">Your wallet asks you to confirm next. Nothing is sent before that.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={cancelReview} disabled={isBusy}>
          Back
        </Button>
        <TxButton
          isSigningTx={signing}
          isConfirmingTx={confirming}
          signingLabel={isBatchFlow ? "Confirm in Safe…" : undefined}
          onClick={confirm}
          disabled={!validator || parsedAmount === 0n}
        >
          Confirm stake
        </TxButton>
      </div>
    </section>
  )
}
