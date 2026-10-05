import { GNOSIS_SNAPSHOT } from "@cobuilders/safenet-core"
import { ConsensusWindowDocument } from "@/graphql/gnosis/generated"
import {
  GNOSIS_BLOCK_SECONDS,
  consensusWindowSince,
  deriveConsensusWindow,
  type ConsensusWindow,
} from "@/lib/consensus"
import { describeDegradation } from "@/lib/subgraph"
import { loading, ready, type Figure } from "@/lib/figure"
import { useSubgraphQuery } from "./useSubgraphQuery"

export const CONSENSUS_MESSAGES = {
  noCompleteDay: "The Gnosis subgraph has not indexed a complete UTC day yet.",
} as const

export interface AttestationRate {
  mean: number
  min: number
  max: number
  /** Complete UTC days the mean is over. */
  days: number
}

export interface Latency {
  medianBlocks: number
  /** Approximate: blocks times the block time. */
  seconds: number
}

const SNAPSHOT_RATE: AttestationRate = {
  mean: GNOSIS_SNAPSHOT.attestationsPerDay,
  min: GNOSIS_SNAPSHOT.attestationsPerDayRange[0],
  max: GNOSIS_SNAPSHOT.attestationsPerDayRange[1],
  days: GNOSIS_SNAPSHOT.windowDays,
}

const SNAPSHOT_LATENCY: Latency = {
  medianBlocks: GNOSIS_SNAPSHOT.latencyMedianBlocks,
  seconds: GNOSIS_SNAPSHOT.latencySeconds,
}

/**
 * Gnosis consensus figures: attestations per day, attestation latency, and participation per
 * validator over the last complete UTC days.
 *
 * From the Gnosis subgraph while it is live and holds a complete day. Otherwise attestations and
 * latency come from the dated snapshot in @cobuilders/safenet-core, and `snapshotReason` says why.
 * Participation has no snapshot fallback here: the overview uses SEF's published figure instead,
 * which their cron refreshes every three hours.
 */
export function useConsensusFigures() {
  const subgraph = useSubgraphQuery("gnosis", "consensus-window", ConsensusWindowDocument, () => ({
    since: consensusWindowSince(Date.now()),
  }))

  const window: ConsensusWindow | undefined =
    subgraph.status === "live" ? deriveConsensusWindow(subgraph.data, subgraph.freshness.checkedAt) : undefined

  let attestations: Figure<AttestationRate> = loading()
  let latency: Figure<Latency> = loading()
  let snapshotReason: string | undefined

  if (window) {
    attestations = ready({ ...window.attestationsPerDay, days: window.days }, "subgraph")
    latency =
      window.latencyMedianBlocks === undefined
        ? ready(SNAPSHOT_LATENCY, "snapshot")
        : ready(
            { medianBlocks: window.latencyMedianBlocks, seconds: Math.round(window.latencyMedianBlocks * GNOSIS_BLOCK_SECONDS) },
            "subgraph",
          )
  } else if (subgraph.status !== "loading") {
    snapshotReason = subgraph.status === "degraded" ? describeDegradation(subgraph.degradation) : CONSENSUS_MESSAGES.noCompleteDay
    attestations = ready(SNAPSHOT_RATE, "snapshot")
    latency = ready(SNAPSHOT_LATENCY, "snapshot")
  }

  return {
    subgraph,
    window,
    attestations,
    latency,
    participation: window?.participation,
    snapshot: GNOSIS_SNAPSHOT,
    snapshotReason,
  }
}
