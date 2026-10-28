import { Trans, useTranslation } from "react-i18next"
import type { SubgraphResult } from "@/hooks/useSubgraphQuery"
import { describeDegradation, formatAge } from "@/lib/subgraph"
import { formatUtcDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ChainFreshnessProps {
  /** "Mainnet" or "Gnosis". A chain's name, the same in every language. */
  chain: string
  result: SubgraphResult<unknown>
  /** What the page shows instead when this subgraph is not live. One plain sentence. */
  fallback: string
}

/** One line per subgraph: the last indexed block and its age, or why it is not used and what is. */
export function ChainFreshness({ chain, result, fallback }: ChainFreshnessProps) {
  const { t } = useTranslation()
  const live = result.status === "live"
  return (
    <div className="flex items-start gap-2 text-sm">
      <span
        className={cn(
          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
          live ? "bg-success" : result.status === "loading" ? "bg-muted-foreground" : "bg-warning",
        )}
        aria-hidden="true"
      />
      {/* Room for the answer while it is checked, so the figures below do not move when it arrives. */}
      <p className="min-h-[3lh] sm:min-h-[2lh] lg:min-h-0">
        <span className="font-medium">{t("overview.freshness.chain", "{{chain}} subgraph:", { chain })} </span>
        {result.status === "loading" && t("overview.freshness.checking", "checking.")}
        {result.status === "live" && (
          <Trans
            i18nKey="overview.freshness.live"
            defaults="live. Last indexed block <block>{{block}}</block>, {{age}} old when checked at {{checkedAt}}."
            values={{
              block: result.freshness.block.toLocaleString("en-US"),
              age: formatAge(result.freshness.ageSeconds ?? 0, t),
              checkedAt: formatUtcDateTime(new Date(result.freshness.checkedAt).toISOString()),
            }}
            components={{ block: <span className="font-mono tabular-nums" /> }}
          />
        )}
        {result.status === "degraded" &&
          t("overview.freshness.notUsed", "not used. {{why}} {{fallback}}", {
            why: describeDegradation(result.degradation, t),
            fallback,
          })}
      </p>
    </div>
  )
}
