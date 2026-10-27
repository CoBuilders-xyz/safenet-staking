import { WithdrawalQueue } from "@/components/withdrawals/WithdrawalQueue"
import { PageHero } from "@/components/PageHero"
import { useWithdrawDelay } from "@/hooks/useStakingReads"
import { Term } from "@/components/ui/term"

export function WithdrawalsPage() {
  const { data: withdrawDelay } = useWithdrawDelay()
  return (
    <div className="space-y-8">
      <PageHero
        title="Withdrawals"
        subtitle={
          <>
            Manage your pending{" "}
            <Term term="unstakingPeriod" unstakingPeriod={withdrawDelay}>
              withdrawals
            </Term>{" "}
            and withdraw undelegated tokens
          </>
        }
      />
      <WithdrawalQueue />
    </div>
  )
}
