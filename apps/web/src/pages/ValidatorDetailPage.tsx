import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { useTranslation } from "react-i18next"
import { useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useAccount } from "wagmi"
import { isAddress, type Address } from "viem"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { DelegateDialog } from "@/components/staking/DelegateDialog"
import { UndelegateDialog } from "@/components/staking/UndelegateDialog"
import { useValidatorTotalStake, useUserStakeOnValidator } from "@/hooks/useStakingReads"
import { useValidators, findValidator } from "@/hooks/useValidators"
import { formatTokenAmount, asBigint } from "@/lib/format"
import { copyToClipboard } from "@/lib/clipboard"
import { useToast } from "@/hooks/useToast"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { Info } from "lucide-react"
import { useWrongNetwork } from "@/hooks/useWrongNetwork"
import { PublishedParticipationRate } from "@/components/validators/ParticipationRate"
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left"
import Copy from "lucide-react/dist/esm/icons/copy"
export function ValidatorDetailPage() {
  const { t } = useTranslation()
  const { address: validatorAddress } = useParams<{ address: string }>()
  const { isConnected } = useAccount()
  const wrongNetwork = useWrongNetwork()
  const { toast } = useToast()

  const isValidAddress = !!validatorAddress && isAddress(validatorAddress)
  const validator = isValidAddress ? (validatorAddress as Address) : ("0x0000000000000000000000000000000000000000" as Address)

  const { data: validators, isLoading: loadingValidators } = useValidators()
  const validatorInfo = findValidator(validators, validator)
  const { data: totalStake, isLoading: loadingTotal } = useValidatorTotalStake(validator)
  const { data: userStake, isLoading: loadingUser } = useUserStakeOnValidator(validator)
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [undelegateOpen, setUndelegateOpen] = useState(false)

  const userStakeAmount = typeof userStake === "bigint" ? userStake : undefined
  const hasStake = userStakeAmount !== undefined && userStakeAmount > 0n
  const isActive = validatorInfo?.isActive ?? false

  if (!isValidAddress) {
    return (
      <div className="space-y-4">
        <Link to="/validators" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("validators.backToValidators", "Back to Validators")}</Link>
        <div className="rounded-lg border p-8 text-center text-muted-foreground">{t("validators.invalidValidatorAddress", "Invalid validator address.")}</div>
      </div>
    )
  }

  if (loadingValidators) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  if (!validatorInfo) {
    return (
      <div className="space-y-4">
        <Link to="/validators" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("validators.backToValidators", "Back to Validators")}</Link>
        <div className="rounded-lg border p-8 text-center text-muted-foreground">{t("validators.validatorNotFound", "Validator not found.")}</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link to="/validators" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t("validators.backToValidators", "Back to Validators")}</Link>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-2xl tracking-tight">
                {validatorInfo.label}
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">{validator}</span>
                <button
                  onClick={async () => {
                    const ok = await copyToClipboard(validator)
                    if (ok) toast({ variant: "success", title: t("validators.addressCopied", "Address copied") })
                  }}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label={t("validators.copyAddress", "Copy address")}
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            {isActive ? (
              <Badge variant="secondary" className="text-sm">{t("validators.active", "Active")}</Badge>
            ) : (
              <Badge className="bg-warning/20 text-warning hover:bg-warning/30 text-sm">{t("programme.withdrawn", "Withdrawn")}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isActive && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{t("validators.itsStakeAndPastParticipationStayShownStaking", "{{WITHDRAWN_STATUS}}. Its stake and past participation stay shown; staking with it is off.", { WITHDRAWN_STATUS: t("programme.withdrawnStatus", "Withdrawn, Aegis participation unconfirmed") })}</p>
          )}
          <div className="flex gap-6 text-sm">
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground">{t("validators.commission", "Commission:")}</span>
              <span className="font-medium">{validatorInfo.commission}%</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-muted-foreground hover:text-foreground" aria-label={t("validators.commissionInfo", "Commission info")}>
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  <p>
                    {t("validators.validatorsEarn5CommissionOnRewardsGeneratedBy", "Validators earn 5% commission on rewards generated by delegated stake.")}{" "}
                    <a
                      href="https://docs.safefoundation.org/safenet/staking/validator-staking"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline text-primary-foreground/80 hover:text-primary-foreground"
                    >{t("validators.seeHereForMoreDetails", "See here for more details")}</a>
                    .
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            <div>
              <span className="text-muted-foreground">{t("validators.participation14d", "Participation (14d):")}</span>
              <PublishedParticipationRate className="font-medium" percent={validatorInfo.participationRate} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })}</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/30 p-4">
              <p className="text-sm text-muted-foreground">{t("validators.totalSafeStaked", "Total SAFE Staked")}</p>
              {loadingTotal ? (
                <Skeleton className="h-7 w-32 mt-1" />
              ) : (
                <p className="text-xl font-mono font-medium tabular-nums">{formatTokenAmount(asBigint(totalStake), 18, 0)}</p>
              )}
            </div>
            {isConnected && (
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">{t("validators.yourSafeStaked", "Your SAFE Staked")}</p>
                {loadingUser ? (
                  <Skeleton className="h-7 w-32 mt-1" />
                ) : (
                  <p className="text-xl font-mono font-medium tabular-nums">{formatTokenAmount(userStakeAmount ?? 0n, 18, 0)}</p>
                )}
              </div>
            )}
          </div>

          {isConnected && (
            <div className="flex gap-3">
              <Button variant="gradient" onClick={() => setDelegateOpen(true)} disabled={!isActive || wrongNetwork}>{t("validators.stake", "Stake")}</Button>
              <Button variant="outline" disabled={!hasStake || wrongNetwork} onClick={() => setUndelegateOpen(true)}>{t("validators.unstake", "Unstake")}</Button>
            </div>
          )}
        </CardContent>
      </Card>

      {delegateOpen && <DelegateDialog validator={validator} open={delegateOpen} onOpenChange={setDelegateOpen} />}
      {undelegateOpen && <UndelegateDialog validator={validator} open={undelegateOpen} onOpenChange={setUndelegateOpen} />}
    </div>
  )
}
