import { useTranslation } from "react-i18next"
import { useAccount } from "wagmi"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useTotalStaked, useUserTotalStake } from "@/hooks/useStakingReads"
import { useValidators } from "@/hooks/useValidators"
import { formatTokenAmount, asBigint } from "@/lib/format"

/** Shown instead of a figure whose read failed, so a failure never reads as zero. */


export function StatsOverview() {
  const { t } = useTranslation()
  const UNAVAILABLE = t("overview.common.unavailable", "Unavailable")
  const { isConnected } = useAccount()
  const { data: totalStaked, isLoading: loadingTotalStaked, isError: totalStakedFailed } = useTotalStaked()
  const { data: userTotalStake, isLoading: loadingUserStake, isError: userStakeFailed } = useUserTotalStake()
  const { data: validators, isLoading: loadingValidators, isError: validatorsFailed } = useValidators()

  const activeCount = validators ? validators.filter((v) => v.isActive).length : 0

  const globalStats = [
    {
      title: t("validators.totalSafeStaked", "Total SAFE Staked"),
      value: loadingTotalStaked ? null : totalStakedFailed && totalStaked === undefined ? UNAVAILABLE : formatTokenAmount(asBigint(totalStaked), 18, 0),
      loading: loadingTotalStaked,
    },
    {
      title: t("dashboard.activeValidators", "Active Validators"),
      value: loadingValidators ? null : validatorsFailed && !validators ? UNAVAILABLE : `${activeCount}`,
      loading: loadingValidators,
    },
  ]

  const userStats = isConnected
    ? [
        {
          title: t("dashboard.yourStakedSafe", "Your Staked SAFE"),
          value: loadingUserStake ? null : userStakeFailed && userTotalStake === undefined ? UNAVAILABLE : formatTokenAmount(asBigint(userTotalStake), 18, 0),
          loading: loadingUserStake,
        },
      ]
    : []

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {globalStats.map((stat) => (
          <Card key={stat.title} className="flex flex-col justify-between min-h-[140px] md:min-h-[200px] p-4 md:px-6 md:py-4">
            <CardHeader className="p-0">
              <CardTitle className="text-base uppercase tracking-[0.04em] text-faint font-normal">
                {stat.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {stat.loading ? (
                <Skeleton className="h-[72px] w-40" />
              ) : (
                <p className="text-[clamp(24px,5vw,56px)] leading-[1.3] font-normal font-mono tracking-[-0.07em]">
                  {stat.value}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {userStats.length > 0 && (
        <div className="grid grid-cols-2 gap-6">
          {userStats.map((stat) => (
            <Card key={stat.title} className="flex flex-col justify-between min-h-[200px] p-4 md:px-6 md:py-4">
              <CardHeader className="p-0">
                <CardTitle className="text-base uppercase tracking-[0.04em] text-faint font-normal">
                  {stat.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {stat.loading ? (
                  <Skeleton className="h-[72px] w-40" />
                ) : (
                  <p className="text-[clamp(24px,5vw,56px)] leading-[1.3] font-normal font-mono tracking-[-0.07em]">
                    {stat.value}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
