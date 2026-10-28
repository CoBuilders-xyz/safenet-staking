import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { Trans, useTranslation } from "react-i18next"
import { useState, useMemo } from "react"
import { Link } from "react-router-dom"
import { useAccount } from "wagmi"
import { useValidators, findValidator, type ValidatorInfo } from "@/hooks/useValidators"
import { useUserStakesOnValidators } from "@/hooks/useStakingReads"
import { useRewards } from "@/hooks/useRewards"
import { useRewardProof, heldPendingCompliance } from "@/hooks/useRewardProof"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { UndelegateDialog } from "@/components/staking/UndelegateDialog"
import { truncateAddress, formatTokenAmount } from "@/lib/format"
import Info from "lucide-react/dist/esm/icons/info"
import { PublishedParticipationRate } from "@/components/validators/ParticipationRate"
import type { Address } from "viem"

const rewardsDocsUrl = "https://docs.safefoundation.org/safenet/staking/rewards"

interface Position {
  validator: Address
  amount: bigint
  isActive: boolean
}

function PositionRow({ position, validators }: { position: Position; validators?: ValidatorInfo[] }) {
  const { t } = useTranslation()
  const metadata = findValidator(validators, position.validator)
  const [undelegateOpen, setUndelegateOpen] = useState(false)

  return (
    <>
      <tr className="border-b last:border-b-0">
        <td className="py-3 pr-4">
          <Link
            to={`/validators/${position.validator}`}
            className="text-sm font-medium hover:underline"
          >
            {metadata ? metadata.label : <span className="font-mono">{truncateAddress(position.validator)}</span>}
          </Link>
        </td>
        <td className="py-3 pr-4 text-sm font-mono font-medium tabular-nums text-right">
          {formatTokenAmount(position.amount, 18, 0)}
        </td>
        <td className="py-3 pr-4 text-sm font-mono tabular-nums text-right text-muted-foreground">
          {metadata ? (
            <PublishedParticipationRate percent={metadata.participationRate} />
          ) : (
            "—"
          )}
        </td>
        <td className="py-3 pr-4 text-right">
          {position.isActive ? (
            <Badge variant="secondary">{t("validators.active", "Active")}</Badge>
          ) : (
            <span className="inline-flex flex-col items-end gap-1">
              <Badge className="bg-warning/20 text-warning hover:bg-warning/30">{t("programme.withdrawn", "Withdrawn")}</Badge>
              <span className="text-xs text-muted-foreground">{t("programme.aegisUnconfirmed", "Aegis participation unconfirmed")}</span>
            </span>
          )}
        </td>
        <td className="py-3 text-right">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUndelegateOpen(true)}
          >{t("validators.unstake", "Unstake")}</Button>
        </td>
      </tr>
      {undelegateOpen && (
        <UndelegateDialog
          validator={position.validator}
          open={undelegateOpen}
          onOpenChange={setUndelegateOpen}
        />
      )}
    </>
  )
}

export function StakingSection() {
  const { t } = useTranslation()
  const { isConnected, address } = useAccount()
  const { data: validators } = useValidators()
  const validatorAddresses = useMemo(
    () => (validators ?? []).map((v) => v.address),
    [validators],
  )
  const { data: stakes, isLoading } = useUserStakesOnValidators(validatorAddresses)
  const { data: rewards } = useRewards()
  const { data: proof } = useRewardProof(address)

  if (!isConnected) {
    return null
  }

  if (isLoading || !validators) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.yourRewards", "Your Rewards")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </CardContent>
      </Card>
    )
  }

  const positions: Position[] = []
  if (stakes) {
    for (let i = 0; i < validatorAddresses.length; i++) {
      const result = stakes[i]
      if (result.status === "success" && typeof result.result === "bigint") {
        const amount = result.result
        if (amount > 0n) {
          const validator = validators.find((v) => v.address === validatorAddresses[i])
          positions.push({
            validator: validatorAddresses[i],
            amount,
            isActive: validator?.isActive ?? false,
          })
        }
      }
    }
  }

  return (
    <>
      <Card style={{ boxShadow: "var(--shadow-elevated)" }}>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>{t("dashboard.yourRewards", "Your Rewards")}</CardTitle>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground" aria-label={t("dashboard.rewardsInfo", "Rewards info")}>
                  <Info className="h-4 w-4" aria-hidden="true" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs text-xs">
                <p>{t("dashboard.rewardsAreSubjectToAMinimumPayoutThreshold", "Rewards are subject to a minimum payout threshold.")}</p>
                <p className="mt-1">{t("dashboard.kycMayBeRequiredToClaimRewards", "KYC may be required to claim rewards.")}</p>
                <p className="mt-1">
                  {t("dashboard.rewardsAreSubjectToDaoApproval", "Rewards are subject to DAO approval.")}{" "}
                  <a
                    href="https://forum.safefoundation.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-primary-foreground/80 hover:text-primary-foreground"
                  >{t("dashboard.followTheProposalHere", "Follow the proposal here")}</a>
                  .
                </p>
                <a
                  href={rewardsDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block underline text-primary-foreground/80 hover:text-primary-foreground"
                >{t("dashboard.learnMore", "Learn more")}</a>
              </TooltipContent>
            </Tooltip>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Rewards */}
          <div className="flex items-center justify-between rounded-md bg-muted/50 p-3">
            <div>
              <span className="text-sm text-muted-foreground">{t("dashboard.claimableSafe", "Claimable SAFE")}</span>
              <p className="font-mono font-medium tabular-nums">{formatTokenAmount(rewards.claimable, 18, 0)}</p>
              {rewards.totalClaimed > 0n && (
                <p className="text-xs text-muted-foreground mt-0.5">{t("dashboard.totalClaimedSafe", "Total claimed: {{amount}} SAFE", { amount: formatTokenAmount(rewards.totalClaimed, 18, 0) })}</p>
              )}
            </div>
            <Button asChild size="sm" variant="gradient">
              <Link to="/rewards">{t("dashboard.goToRewards", "Go to Rewards")}</Link>
            </Button>
          </div>

          {/* Compliance note */}
          {address && heldPendingCompliance(proof) > 0n && (
            <p className="text-sm text-muted-foreground rounded-md border border-border bg-muted/50 px-3 py-2">
              <Trans i18nKey="dashboard.complianceNote" defaults="Some rewards for <address>{{address}}</address> are pending compliance checks. Please reach out to the Safe Ecosystem Foundation at <email>legal@safefoundation.org</email>."
                values={{ address: truncateAddress(address) }}
                components={{ address: <span className="font-mono" />, email: <a href="mailto:legal@safefoundation.org" className="underline hover:text-foreground transition-colors" /> }} />
            </p>
          )}

          {/* Positions */}
          {positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <Trans i18nKey="dashboard.noStakes" defaults="You have no active stakes. Visit the <validators>Validators</validators> page to stake."
                components={{ validators: <Link to="/validators" className="text-primary underline hover:text-primary/80" /> }} />
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 text-left font-medium">{t("dashboard.validator", "Validator")}</th>
                    <th className="pb-2 pr-4 text-right font-medium">{t("dashboard.safeAmount", "SAFE Amount")}</th>
                    <th className="pb-2 pr-4 text-right font-medium">{t("dashboard.participation14d", "Participation (14d)")}</th>
                    <th className="pb-2 pr-4 text-right font-medium">{t("dashboard.status", "Status")}</th>
                    <th className="pb-2 text-right font-medium">{t("dashboard.action", "Action")}</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((pos) => (
                    <PositionRow key={pos.validator} position={pos} validators={validators} />
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-muted-foreground">{t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
