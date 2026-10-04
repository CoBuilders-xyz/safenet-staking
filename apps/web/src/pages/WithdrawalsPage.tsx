import { WithdrawalQueue } from "@/components/withdrawals/WithdrawalQueue"
import { PageHero } from "@/components/PageHero"

export function WithdrawalsPage() {
  return (
    <div className="space-y-8">
      <PageHero
        title="Withdrawals"
        subtitle="Manage your pending withdrawals and withdraw undelegated tokens"
      />
      <WithdrawalQueue />
    </div>
  )
}
