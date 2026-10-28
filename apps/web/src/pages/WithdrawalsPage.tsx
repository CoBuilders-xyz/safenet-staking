import { useTranslation } from "react-i18next"
import { WithdrawalQueue } from "@/components/withdrawals/WithdrawalQueue"
import { PageHero } from "@/components/PageHero"

export function WithdrawalsPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-8">
      <PageHero
        title={t("withdrawals.withdrawals", "Withdrawals")}
        subtitle={t("withdrawals.manageYourPendingWithdrawalsAndWithdrawUndelegatedTokens", "Manage your pending withdrawals and withdraw undelegated tokens")}
      />
      <WithdrawalQueue />
    </div>
  )
}
