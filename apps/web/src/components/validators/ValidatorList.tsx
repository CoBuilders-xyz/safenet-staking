import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { useTranslation } from "react-i18next"
import { useMemo, useState } from "react"
import { useValidators } from "@/hooks/useValidators"
import {
  useValidatorTotalStakes,
  useUserStakesOnValidators,
} from "@/hooks/useStakingReads"
import { useValidatorDirectory } from "@/hooks/useValidatorDirectory"
import { useConsensusFigures } from "@/hooks/useConsensusFigures"
import { useEnsNames, nameSourceCaption } from "@/hooks/useEnsNames"
import { ValidatorCard } from "./ValidatorCard"
import { Segmented } from "./Segmented"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw"
import type { Address } from "viem"
import { shortDay } from "@/lib/utcDates"
import {
  filterOptions,
  sortOptions,
  sortAndFilter,
  type ListFilter,
  type SortKey,
} from "@/lib/validatorSort"

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
  const { entries: directory } = useValidatorDirectory()
  const { participation: missedFigures, window: missedWindow, betaOnly, subgraph: gnosis, snapshotReason } = useConsensusFigures()
  const ens = useEnsNames(validatorAddresses)
  const [sort, setSort] = useState<SortKey>("stake")
  const [filter, setFilter] = useState<ListFilter>("all")
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

  const onChain = directory.state === "ready" ? directory.value : undefined
  const rows = sortAndFilter(
    validators.map((v) => {
      const entry = onChain?.get(v.address.toLowerCase())
      return {
        info: v,
        isActive: v.isActive,
        stake: totalStakeMap.get(v.address),
        participation: v.participationRate,
        delegators: entry?.delegators,
        registeredAt: entry?.registeredAt?.timestamp,
        missed: missedFigures?.get(v.address.toLowerCase())?.absences,
      }
    }),
    sort,
    filter,
  )

  const missedLabel = missedWindow
    ? betaOnly
      ? t("selector.missedBeta", "Missed, Beta's last {{days}} days", { days: missedWindow.days })
      : t("selector.missedDays", "Missed, last {{days}} days", { days: missedWindow.days })
    : t("selector.missed", "Missed ceremonies")
  const onChainSource =
    directory.state === "unavailable"
      ? t("selector.directoryUnavailable", "Delegators and registration: unavailable. {{reason}}", { reason: directory.reason })
      : t("selector.directorySource", "Delegators and registration: the Mainnet subgraph; a delegator is an address with a non-zero stake.")
  const missedSource = missedWindow
    ? t("selector.missedSource", "Missed ceremonies: Gnosis subgraph, {{programme}}, {{days}} complete UTC days, {{from}} to {{to}}.", { programme: betaOnly ? "Beta" : "Aegis", days: missedWindow.days, from: shortDay(missedWindow.from), to: shortDay(missedWindow.to) }) + (betaOnly ? " " + t("selector.historicalBeta", "Beta has ended. These are historical figures.") : "")
    : gnosis.status === "loading"
      ? ""
      : t("selector.missedUnavailable", "Missed ceremonies unavailable. {{reason}}", { reason: snapshotReason ?? t("overview.reason.noCompleteDay", "The Gnosis subgraph has not indexed a complete UTC day yet.") })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <Segmented label={t("selector.sortBy", "Sort by")} options={sortOptions(t)} value={sort} onChange={setSort} />
        <Segmented label={t("selector.show", "Show")} options={filterOptions(t)} value={filter} onChange={setFilter} />
      </div>
      {rows.length === 0 ? (
        <div className="border p-8 text-center text-muted-foreground">
          {t("selector.noActive", "No active validator. Show all to see the withdrawn ones.")}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {rows.map(({ info: v, delegators, registeredAt, missed }) => {
            const lookup = ens.get(v.address.toLowerCase())
            return (
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
                ensName={lookup?.status === "found" ? lookup.name : undefined}
                delegators={delegators}
                registeredAt={registeredAt}
                missed={missed}
                missedLabel={missedLabel}
              />
            )
          })}
        </div>
      )}
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>{t("selector.publishedSource", "Participation (14d): SEF's published figure.")} {onChainSource} {missedSource}</p>
        <p>{nameSourceCaption(validatorAddresses.map((a) => ens.get(a.toLowerCase())), t)}</p>
        <p>{t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })}</p>
      </div>
    </div>
  )
}
