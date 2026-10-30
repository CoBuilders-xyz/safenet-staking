import { useTranslation } from "react-i18next"
import { useState, useEffect } from "react"
import { Link } from "react-router-dom"
import type { Address } from "viem"
import { useAccount } from "wagmi"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DelegateDialog } from "@/components/staking/DelegateDialog"
import { UndelegateDialog } from "@/components/staking/UndelegateDialog"
import { type ValidatorInfo, findValidator } from "@/hooks/useValidators"
import { truncateAddress, formatTokenAmount } from "@/lib/format"
import { copyToClipboard } from "@/lib/clipboard"
import { useToast } from "@/hooks/useToast"
import { useWrongNetwork } from "@/hooks/useWrongNetwork"
import { Term } from "@/components/ui/term"
import { shortDay } from "@/lib/utcDates"
import { PublishedParticipationRate } from "./ParticipationRate"

interface ValidatorCardProps {
  validator: Address
  isActive: boolean
  autoOpenDelegate?: boolean
  totalStake?: bigint
  loadingTotalStake?: boolean
  userStake?: bigint
  loadingUserStake?: boolean
  validators?: ValidatorInfo[]
  /** The ENS primary name, when one is set. SEF's label shows otherwise. */
  ensName?: string
  /** Addresses staking with it now. Undefined while unknown. */
  delegators?: number
  /** Unix seconds of its latest registration on the Staking contract. */
  registeredAt?: number
  /** Ceremonies missed in the window `missedLabel` names. */
  missed?: bigint
  /** The window of `missed`, such as "Missed, Beta's last 14 days". */
  missedLabel?: string
}

export function ValidatorCard({
  validator,
  isActive,
  autoOpenDelegate,
  totalStake,
  loadingTotalStake,
  userStake,
  loadingUserStake,
  validators,
  ensName,
  delegators,
  registeredAt,
  missed,
  missedLabel,
}: ValidatorCardProps) {
  const { t } = useTranslation()
  const { isConnected } = useAccount()
  const loadingTotal = loadingTotalStake ?? false
  const loadingUser = loadingUserStake ?? false
  const metadata = findValidator(validators, validator)
  const { toast } = useToast()
  const wrongNetwork = useWrongNetwork()
  const [delegateOpen, setDelegateOpen] = useState(false)
  const [undelegateOpen, setUndelegateOpen] = useState(false)

  const hasStake = userStake !== undefined && userStake > 0n

  useEffect(() => {
    if (autoOpenDelegate && isActive) {
      setDelegateOpen(true)
    }
  }, [autoOpenDelegate, isActive])

  const cardBorder = isActive
    ? "border-border"
    : "border-border/60"

  const cardBg = isActive
    ? "bg-card"
    : "bg-surface-2/60"

  // Inactive cards dim the name and values to 60% opacity
  const nameColor = isActive
    ? "text-foreground"
    : "text-muted-foreground"
  const valueColor = isActive
    ? "text-foreground"
    : "text-muted-foreground"

  return (
    <>
      <div
        className={`flex flex-col overflow-hidden rounded-lg border ${cardBorder} ${cardBg}`}
      >
        {/* Header: name + badge, 78px, border-bottom */}
        <div
          className="flex items-center justify-between
            px-6 py-4 border-b border-border"
          style={{ minHeight: 78 }}
        >
          <div className="min-w-0 flex flex-col gap-1">
            <Link
              to={`/validators/${validator}`}
              className={`text-2xl font-normal hover:underline truncate block
                leading-none ${nameColor}`}
            >
              {ensName ?? (metadata
                ? metadata.label
                : <span className="font-mono">
                    {truncateAddress(validator)}
                  </span>)}
            </Link>
            {ensName && (
              <span className="text-xs text-faint">
                <abbr title={t("selector.ensTitle", "Ethereum Name Service primary name")}>{t("selector.ens", "ENS")}</abbr>
                {metadata && ` · ${t("selector.sefLabel", "SEF lists it as {{name}}", { name: metadata.label })}`}
              </span>
            )}
            {(metadata || ensName) && (
              <button
                className="text-sm font-mono
                  text-faint
                  hover:text-foreground transition-colors text-left
                  leading-[18px]"
                onClick={async () => {
                  const ok = await copyToClipboard(validator)
                  if (ok) {
                    toast({ variant: "success", title: t("validators.addressCopied", "Address copied") })
                  }
                }}
                title={t("validators.copyValidatorAddress", "Copy validator address")}
              >
                {truncateAddress(validator)}
              </button>
            )}
          </div>
          {isActive ? (
            <span
              className="shrink-0 inline-flex items-center rounded-sm
                px-[7px] py-[3px] text-sm font-mono uppercase
                leading-[18px]
                text-success
                bg-success/10
                border border-success/40"
            >{t("validators.active", "Active")}</span>
          ) : (
            <span
              className="shrink-0 inline-flex items-center rounded-sm
                px-[7px] py-[3px] text-sm font-mono uppercase
                leading-[18px]
                text-destructive
                bg-destructive/15
                border border-destructive/40"
            >
              {t("programme.withdrawn", "Withdrawn")}
            </span>
          )}
        </div>

        {/* Content: two columns with vertical divider */}
        <div className="flex flex-1 min-h-0">
          {/* Left column — Commission */}
          <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-4">
            <span className="text-base font-heading text-faint leading-none">
              <Term term="commission">{t("onboarding.commission", "Commission")}</Term>:
            </span>
            <span className={`text-xl font-mono leading-none uppercase ${valueColor}`}>
              {metadata ? `${metadata.commission}%` : "—"}
            </span>
          </div>
          {/* Vertical divider */}
          <div className="w-px bg-border self-stretch" />
          {/* Right column — Participation */}
          <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-4">
            <span className="text-base font-heading text-faint leading-none">{t("validators.participation14d", "Participation (14d):")}</span>
            <span className={`text-xl font-mono leading-none uppercase ${valueColor}`}>
              {metadata ? (
                <PublishedParticipationRate percent={metadata.participationRate} />
              ) : (
                "—"
              )}
            </span>
          </div>
        </div>

        {/* Delegators and registration, from the Mainnet subgraph */}
        <div className="flex border-t border-border">
          <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-4">
            <span className="text-base font-heading text-faint leading-none">
              {t("selector.delegatorsColon", "Delegators:")}
            </span>
            <span className={`text-xl font-mono leading-none ${valueColor}`}>
              {delegators === undefined ? "—" : delegators.toLocaleString("en-US")}
            </span>
          </div>
          <div className="w-px bg-border self-stretch" />
          <div className="min-w-0 flex-1 flex flex-col gap-1 px-4 py-4">
            <span className="text-base font-heading text-faint leading-none">
              {t("selector.registeredColon", "Registered:")}
            </span>
            <span className={`text-xl font-mono leading-none ${valueColor}`}>
              {registeredAt === undefined ? "—" : shortDay(registeredAt)}
            </span>
          </div>
        </div>

        {/* Missed ceremonies, from the Gnosis subgraph */}
        <div
          className="flex items-center justify-between gap-3
            px-6 py-4 border-t border-border"
        >
          <span className="text-base font-heading text-faint leading-none">
            {missedLabel ?? t("selector.missed", "Missed ceremonies")}
          </span>
          <span className={`text-xl font-mono leading-none ${valueColor}`}>
            {missed === undefined ? "—" : missed.toLocaleString("en-US")}
          </span>
        </div>

        {/* Footer: Total SAFE Staked, border-top */}
        <div
          className="flex items-center justify-between
            px-6 py-4 border-t border-border"
          style={{ minHeight: 52 }}
        >
          <span className="text-base font-heading text-faint leading-none">{t("validators.totalSafeStaked", "Total SAFE Staked")}</span>
          {loadingTotal ? (
            <Skeleton className="h-5 w-28" />
          ) : (
            <span className={`text-xl font-mono leading-none uppercase ${valueColor}`}>
              {formatTokenAmount(totalStake ?? 0n, 18, 0)}
            </span>
          )}
        </div>

        {/* Connected: user stake + actions */}
        {isConnected && (
          <>
            <div
              className="flex items-center justify-between
                px-6 py-4 border-t border-border"
              style={{ minHeight: 52 }}
            >
              <span className="text-base font-heading text-faint leading-none">{t("validators.yourStake", "Your Stake")}</span>
              {loadingUser ? (
                <Skeleton className="h-5 w-28" />
              ) : (
                <span className={`text-xl font-mono leading-none uppercase ${valueColor}`}>
                  {formatTokenAmount(userStake ?? 0n, 18, 0)}
                </span>
              )}
            </div>
            <div
              className="flex gap-3 px-6 py-3
                border-t border-border"
            >
              <Button
                size="sm"
                variant="gradient"
                className="flex-1"
                onClick={() => setDelegateOpen(true)}
                disabled={!isActive || wrongNetwork}
              >{t("validators.stake", "Stake")}</Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={!hasStake || wrongNetwork}
                onClick={() => setUndelegateOpen(true)}
              >{t("validators.unstake", "Unstake")}</Button>
            </div>
          </>
        )}
      </div>

      {delegateOpen && (
        <DelegateDialog
          validator={validator}
          open={delegateOpen}
          onOpenChange={setDelegateOpen}
        />
      )}
      {undelegateOpen && (
        <UndelegateDialog
          validator={validator}
          open={undelegateOpen}
          onOpenChange={setUndelegateOpen}
        />
      )}
    </>
  )
}
