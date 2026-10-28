import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { useTranslation } from "react-i18next"
import { useMemo } from "react"
import { useValidators } from "@/hooks/useValidators"
import {
  useValidatorTotalStakes,
  useUserStakesOnValidators,
} from "@/hooks/useStakingReads"
import { ValidatorCard } from "./ValidatorCard"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw"
import type { Address } from "viem"

export function ValidatorList({
  autoOpenDelegate,
}: {
  autoOpenDelegate?: string
}) {
  const { t } = useTranslation()
  const { data: validators, isLoading, error, refetch } = useValidators()
  const validatorAddresses = useMemo(
    () => (validators ?? []).map((v) => v.address),
    [validators],
  )
  const { data: totalStakesData, isLoading: loadingTotalStakes } =
    useValidatorTotalStakes(validatorAddresses)
  const { data: userStakesData, isLoading: loadingUserStakes } =
    useUserStakesOnValidators(validatorAddresses)
  const totalStakeMap = useMemo(() => {
    const map = new Map<Address, bigint>()
    if (!totalStakesData || !validators) return map
    for (let i = 0; i < validators.length; i++) {
      const result = totalStakesData[i]
      if (result?.status === "success" && typeof result.result === "bigint") {
        map.set(validators[i].address, result.result)
      }
    }
    return map
  }, [totalStakesData, validators])
  const userStakeMap = useMemo(() => {
    const map = new Map<Address, bigint>()
    if (!userStakesData || !validators) return map
    for (let i = 0; i < validators.length; i++) {
      const result = userStakesData[i]
      if (result?.status === "success" && typeof result.result === "bigint") {
        map.set(validators[i].address, result.result)
      }
    }
    return map
  }, [userStakesData, validators])

  if (isLoading) {
    return (
      <div className="grid gap-6 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{t("validators.failedToLoadValidators", "Failed to load validators. Please try again.")}</div>
    )
  }

  if (!validators || validators.length === 0) {
    return (
      <div className="border p-8 text-center space-y-4">
        <p className="text-muted-foreground">{t("validators.noValidatorsAreCurrentlyAvailable", "No validators are currently available.")}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />
          {t("validators.refresh", "Refresh")}</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-6 sm:grid-cols-2">
        {validators.map((v) => (
          <ValidatorCard
            key={v.address}
            validator={v.address}
            isActive={v.isActive}
            autoOpenDelegate={
              autoOpenDelegate?.toLowerCase() === v.address.toLowerCase()
            }
            totalStake={totalStakeMap.get(v.address)}
            loadingTotalStake={loadingTotalStakes}
            userStake={userStakeMap.get(v.address)}
            loadingUserStake={loadingUserStakes}
            validators={validators}
          />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })}</p>
    </div>
  )
}
