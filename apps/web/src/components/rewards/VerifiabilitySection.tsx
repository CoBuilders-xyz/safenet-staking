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
  if (read.error) return <span className="text-sm">Unavailable</span>
  if (!read.data) return <Skeleton className="h-5 w-full" aria-label={`Loading ${label}`} />
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
  const { merkleDrop, onChainRoot, latest, latestSource, dropBalance, rootMatches } = programme

  if (!merkleDrop) {
    return (
      <RewardsSection title="Verifiability" source="The MerkleDrop contract on Ethereum.">
        <SectionNote>{MESSAGES.noMerkleDrop}</SectionNote>
      </RewardsSection>
    )
  }

  const explorerUrl = explorerAddressUrl(merkleDrop)

  return (
    <RewardsSection
      title="Verifiability"
      source={
        <>
          On-chain root and balance: the MerkleDrop contract on Ethereum. Published root: SEF&apos;s
          file <PublishedFileLink href={latestSource?.url} />.
        </>
      }
    >
      <dl>
        <Field label="MerkleDrop contract">
          <code className="block break-all font-mono text-xs">{merkleDrop}</code>
          {explorerUrl && (
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline hover:text-foreground">
              View on {explorerName}
            </a>
          )}
        </Field>
        <Field label="Root on chain">
          <HexValue read={onChainRoot} label="root on chain" />
        </Field>
        <Field label="Root published by SEF">
          <HexValue read={{ data: latest.data?.merkleRoot, error: latest.error }} label="published root" />
        </Field>
        <Field label="Source">
          <SourceValue source={latestSource} error={latest.error} />
        </Field>
        <Field label="Roots">
          <RootIndicator matches={rootMatches} />
        </Field>
        <Field label="Contract balance">
          {dropBalance.error ? (
            <span className="text-sm">Unavailable</span>
          ) : dropBalance.data === undefined ? (
            <Skeleton className="h-5 w-32" aria-label="Loading contract balance" />
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
        <SectionNote>
          The contract holds a different root from the one SEF published. Claims built from the
          published files fail until the two match.
        </SectionNote>
      )}
    </RewardsSection>
  )
}

/** Which source the published root was read from, and the gateway or why the mirror was read. */
function SourceValue({ source, error }: { source: ReturnType<typeof useProgrammeRewards>["latestSource"]; error: unknown }) {
  if (!source) {
    if (error) return <span className="text-sm">Unavailable</span>
    return <Skeleton className="h-5 w-48" aria-label="Loading source" />
  }
  const { base, ens } = source
  const reason = base.kind === "repository" ? repositoryReason(ens) : undefined
  return (
    <>
      <span className="text-sm">
        {rewardsSourceLabel(base)}, through {rewardsSourceHost(base)}
      </span>
      {reason && <p className="text-xs text-muted-foreground">{reason}</p>}
    </>
  )
}

function RootIndicator({ matches }: { matches: boolean | undefined }) {
  if (matches === undefined) return <span className="text-sm text-muted-foreground">Not compared yet</span>
  return matches ? (
    <Badge variant="outline" className="border-success text-success">Match</Badge>
  ) : (
    <Badge variant="destructive">Differs</Badge>
  )
}
