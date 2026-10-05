import type { SubgraphResult } from "@/hooks/useSubgraphQuery"
import { describeDegradation, formatAge } from "@/lib/subgraph"
import { formatUtcDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ChainFreshnessProps {
  /** "Mainnet" or "Gnosis". */
  chain: string
  result: SubgraphResult<unknown>
  /** What the page shows instead when this subgraph is not live. One plain sentence. */
  fallback: string
}

/** One line per subgraph: the last indexed block and its age, or why it is not used and what is. */
export function ChainFreshness({ chain, result, fallback }: ChainFreshnessProps) {
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
      <p>
        <span className="font-medium">{chain} subgraph: </span>
        {result.status === "loading" && "checking."}
        {result.status === "live" && (
          <>
            live. Last indexed block{" "}
            <span className="font-mono tabular-nums">{result.freshness.block.toLocaleString("en-US")}</span>,{" "}
            {formatAge(result.freshness.ageSeconds ?? 0)} old when checked at {formatUtcDateTime(new Date(result.freshness.checkedAt).toISOString())}.
          </>
        )}
        {result.status === "degraded" && (
          <>
            not used. {describeDegradation(result.degradation)} {fallback}
          </>
        )}
      </p>
    </div>
  )
}
