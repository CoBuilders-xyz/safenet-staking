import { Trans, useTranslation } from "react-i18next"
import { WithdrawalQueue } from "@/components/withdrawals/WithdrawalQueue"
import { PageHero } from "@/components/PageHero"
import { useWithdrawDelay } from "@/hooks/useStakingReads"
import { Term } from "@/components/ui/term"

export function WithdrawalsPage() {
  const { t } = useTranslation()
  const { data: withdrawDelay } = useWithdrawDelay()
  return (
    <div className="space-y-8">
      <PageHero
        title={t("withdrawals.withdrawals", "Withdrawals")}
        subtitle={<Trans i18nKey="onboarding.hero.withdrawals" defaults="Manage your pending <withdrawals>withdrawals</withdrawals> and withdraw undelegated tokens" components={{ withdrawals: <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay} children={null} /> }} />}
      />
      <WithdrawalQueue />
    </div>
  )
}
