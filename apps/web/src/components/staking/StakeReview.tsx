import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { useId, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { TxButton } from "@/components/ui/TxButton"
import { Term } from "@/components/ui/term"
import { useValidators, findValidator } from "@/hooks/useValidators"
import type { StakeFormState } from "@/hooks/useStakeForm"
import { unstakingPeriodText } from "@/lib/glossary"
import { formatTokenAmount, truncateAddress } from "@/lib/format"
import { Trans, useTranslation } from "react-i18next"

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
  const { t } = useTranslation()
  const titleId = useId()
  const { data: validators } = useValidators()
  const { validator, parsedAmount, withdrawDelay, isBatchFlow, stake, batch, cancelReview, isBusy } = form
  const period = unstakingPeriodText(withdrawDelay)
  const validatorName = validator ? (findValidator(validators, validator)?.label ?? truncateAddress(validator)) : t("onboarding.theValidator", "the validator")

  const scenarios: Scenario[] = [
    {
      question: t("onboarding.iWantMySAFEBack", "I want my SAFE back?"),
      answer: (
        <Trans i18nKey="onboarding.withdrawAnswer" defaults="Undelegate at any time. The SAFE then waits in the staking contract for <period>{{period}}</period>, earns no rewards and cannot be moved. A second transaction claims it to your wallet." components={{ period: <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay} children={null} /> }} values={{ period }} />
      ),
    },
    {
      question: t("onboarding.iWantToMoveToAnotherValidator", "I want to move to another validator?"),
      answer:
        t("onboarding.thereIsNoDirectSwitchUndelegateWaitOutThe", "There is no direct switch. Undelegate, wait out the unstaking period, claim, then delegate again. Nothing is earned in between."),
    },
    {
      question: t("onboarding.thisValidatorsParticipationDrops", "this validator's participation drops?"),
      answer: t("onboarding.participationAnswer", "{{rule}} Your SAFE stays staked either way.", { rule: t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 }) }),
    },
    {
      question: t("onboarding.somethingGoesWrong", "something goes wrong?"),
      answer: (
        <Trans i18nKey="onboarding.riskAnswer" defaults="Staked SAFE is not currently subject to <slashing>slashing</slashing>: poor performance costs rewards, not the SAFE itself. The staking contract cannot be upgraded and was audited, but like any contract it can have defects." components={{ slashing: <Term term="slashing" children={null} /> }} />
      ),
    },
    {
      question: t("onboarding.rewardsAreLowerThanIExpect", "rewards are lower than I expect?"),
      answer: (
        <Trans i18nKey="onboarding.rewardsAnswer" defaults="<rewards>Rewards</rewards> are not guaranteed. They depend on the validator’s participation and commission, on the SAFE staked across the network, and on how long yours stays staked. They are not added to your stake: you claim them." components={{ rewards: <Term term="rewards" children={null} /> }} />
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
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="space-y-1">
        <h3 id={titleId} className="text-base font-semibold">
          {t("onboarding.beforeStake", "Before you stake {{amount}} SAFE with {{validator}}", { amount: formatTokenAmount(parsedAmount), validator: validatorName })}
        </h3>
        <p className="text-sm text-muted-foreground">{t("onboarding.whatHappensIf", "What happens if…")}</p>
      </div>
      <dl className="space-y-3 text-sm">
        {scenarios.map(({ question, answer }) => (
          <div key={question}>
            <dt className="font-medium">…{question}</dt>
            <dd className="text-muted-foreground">{answer}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">{t("onboarding.yourWalletAsksYouToConfirmNextNothingIs", "Your wallet asks you to confirm next. Nothing is sent before that.")}</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={cancelReview} disabled={isBusy}>
          {t("onboarding.back", "Back")}</Button>
        <TxButton
          isSigningTx={signing}
          isConfirmingTx={confirming}
          signingLabel={isBatchFlow ? t("staking.confirmInSafe", "Confirm in Safe…") : undefined}
          onClick={confirm}
          disabled={!validator || parsedAmount === 0n}
        >
          {t("onboarding.confirmStake", "Confirm stake")}</TxButton>
      </div>
    </section>
  )
}
