import { Trans, useTranslation } from "react-i18next"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import type { useProgrammeRewards } from "@/hooks/useProgrammeRewards"
import { explorerAddressUrl, explorerName } from "@/lib/explorer"
import { formatTokenAmount } from "@/lib/format"
import { repositoryReason, rewardsSourceHost, rewardsSourceLabel } from "@/lib/rewardsSource"
import { PublishedFileLink } from "./ProgrammeSection"
import { MESSAGES } from "./messages"
import { RewardsSection, SectionError, SectionNote } from "./RewardsSection"

interface Readable<T> {
  data: T | undefined
  error: unknown
}

/** A long hex value, its loading and error states, on its own line so it never truncates. */
function HexValue({ read, label }: { read: Readable<string>; label: string }) {
  const { t } = useTranslation()
  if (read.error) return <span className="text-sm">{t("rewards.unavailable", "Unavailable")}</span>
  if (!read.data) return <Skeleton className="h-5 w-full" aria-label={t("rewards.loading2", "Loading {{label}}", { label: label })} />
  return <code className="block break-all font-mono text-xs">{read.data}</code>
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

export function VerifiabilitySection({ programme }: { programme: ReturnType<typeof useProgrammeRewards> }) {
  const { t } = useTranslation()
  const { merkleDrop, onChainRoot, latest, latestSource, dropBalance, rootMatches } = programme

  if (!merkleDrop) {
    return (
      <RewardsSection title={t("rewards.verifiability", "Verifiability")} source={t("rewards.theMerkledropContractOnEthereum", "The MerkleDrop contract on Ethereum.")}>
        <SectionNote>{MESSAGES.noMerkleDrop}</SectionNote>
      </RewardsSection>
    )
  }

  const explorerUrl = explorerAddressUrl(merkleDrop)

  return (
    <RewardsSection
      title={t("rewards.verifiability", "Verifiability")}
      source={<Trans i18nKey="rewards.verifiabilitySource" defaults="On-chain root and balance: the MerkleDrop contract on Ethereum. Published root: SEF's file <file>rewards/latest.json</file>." components={{ file: <PublishedFileLink href={latestSource?.url} /> }} />}
    >
      <dl>
        <Field label={t("rewards.merkledropContract", "MerkleDrop contract")}>
          <code className="block break-all font-mono text-xs">{merkleDrop}</code>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline hover:text-foreground">{t("rewards.viewOn", "View on {{explorerName}}", { explorerName: explorerName })}</a>
          )}
        </Field>
        <Field label={t("rewards.rootOnChain", "Root on chain")}>
          <HexValue read={onChainRoot} label={t("rewards.rootOnChain2", "root on chain")} />
        </Field>
        <Field label={t("rewards.rootPublishedBySef", "Root published by SEF")}>
          <HexValue read={{ data: latest.data?.merkleRoot, error: latest.error }} label={t("rewards.publishedRoot", "published root")} />
        </Field>
        <Field label={t("rewards.sourceOfLatestJson", "Source of latest.json")}>
          <SourceValue source={latestSource} error={latest.error} />
        </Field>
        <Field label={t("rewards.roots", "Roots")}>
          <RootIndicator matches={rootMatches} />
        </Field>
        <Field label={t("rewards.contractBalance", "Contract balance")}>
          {dropBalance.error ? (
            <span className="text-sm">{t("rewards.unavailable", "Unavailable")}</span>
          ) : dropBalance.data === undefined ? (
            <Skeleton className="h-5 w-32" aria-label={t("rewards.loadingContractBalance", "Loading contract balance")} />
          ) : (
            <span className="font-mono font-medium tabular-nums">{formatTokenAmount(dropBalance.data, 18, 0)} SAFE</span>
          )}
        </Field>
      </dl>
      {(onChainRoot.error || dropBalance.error) && (
        <SectionError
          message={MESSAGES.contractReadFailed}
          onRetry={() => {
            void onChainRoot.refetch()
            void dropBalance.refetch()
          }}
        />
      )}
      {latest.error && <SectionError message={MESSAGES.latestFileFailed} />}
      {rootMatches === false && (
        <SectionNote>{t("rewards.theContractHoldsADifferentRootFromThe", "The contract holds a different root from the one SEF published. Claims built from the published files fail until the two match.")}</SectionNote>
      )}
    </RewardsSection>
  )
}

/**
 * Which source latest.json, and so the published root, was read from, and the gateway or why
 * the mirror was read. Each address's proof is read the same way, on its own.
 */
function SourceValue({ source, error }: { source: ReturnType<typeof useProgrammeRewards>["latestSource"]; error: unknown }) {
  const { t } = useTranslation()
  if (!source) {
    if (error) return <span className="text-sm">{t("rewards.unavailable", "Unavailable")}</span>
    return <Skeleton className="h-5 w-48" aria-label={t("rewards.loadingSource", "Loading source")} />
  }
  const { base, ens, tried } = source
  const reason = base.kind === "repository" ? repositoryReason(ens, tried) : undefined
  return (
    <>
      <span className="text-sm">{t("rewards.through", "{{value}}, through {{value1}}", { value: rewardsSourceLabel(base), value1: rewardsSourceHost(base) })}</span>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </>
  )
}

function RootIndicator({ matches }: { matches: boolean | undefined }) {
  const { t } = useTranslation()
  if (matches === undefined) return <span className="text-sm text-muted-foreground">{t("rewards.notComparedYet", "Not compared yet")}</span>
  return matches ? (
    <Badge variant="outline" className="border-success text-success">{t("rewards.match", "Match")}</Badge>
  ) : (
    <Badge variant="destructive">{t("rewards.differs", "Differs")}</Badge>
  )
}
