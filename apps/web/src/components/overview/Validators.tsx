import { Link } from "react-router-dom"
import type { Address } from "viem"
import { formatTokenAmount, truncateAddress } from "@/lib/format"

export interface ValidatorTableRow {
  address: Address
  label: string | undefined
  stake: bigint
  share: number
  /** Addresses staking with this validator now. Undefined when the source does not have it. */
  stakers: number | undefined
  /** Fraction of attestation ceremonies attended. Undefined when no source has it. */
  participation: number | undefined
  /** Where this row's participation comes from. */
  participationSource?: "subgraph" | "sef"
  /** Ceremonies missed in the same window. Only the subgraph counts them. */
  absences: bigint | undefined
}

/**
 * Validators by stake. Participation shows the rate and, when the subgraph has it, the raw count
 * of missed ceremonies: the count is what a staker can act on.
 */
export function Validators({ rows }: { rows: readonly ValidatorTableRow[] }) {
  const showStakers = rows.some((r) => r.stakers !== undefined)
  // Mark the source per row only when the rows mix sources; otherwise the caption says it.
  const mixed = new Set(rows.map((r) => r.participationSource).filter(Boolean)).size > 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-faint">
            <th scope="col" className="py-2.5 pr-3 text-left font-normal">Validator</th>
            <th scope="col" className="px-3 py-2.5 text-right font-normal">Staked</th>
            <th scope="col" className="px-3 py-2.5 text-right font-normal">Share</th>
            {showStakers && <th scope="col" className="px-3 py-2.5 text-right font-normal">Stakers</th>}
            <th scope="col" className="py-2.5 pl-3 text-right font-normal">Participation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.address} className="border-b border-border last:border-0">
              <td className="py-3 pr-3">
                <Link to={`/validators/${v.address}`} className="font-medium hover:underline">
                  {v.label ?? truncateAddress(v.address)}
                </Link>
                <div className="font-mono text-xs text-faint">{truncateAddress(v.address)}</div>
              </td>
              <td className="px-3 py-3 text-right font-mono tabular-nums">{formatTokenAmount(v.stake, 18, 0)}</td>
              <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                {(v.share * 100).toFixed(1)}%
              </td>
              {showStakers && (
                <td className="px-3 py-3 text-right font-mono tabular-nums text-muted-foreground">
                  {v.stakers === undefined ? "—" : v.stakers.toLocaleString("en-US")}
                </td>
              )}
              <td className="py-3 pl-3 text-right font-mono tabular-nums">
                {v.participation === undefined ? (
                  <span className="text-muted-foreground">Not available</span>
                ) : (
                  <>
                    {(v.participation * 100).toFixed(2)}%
                    {v.absences !== undefined && (
                      <div className="text-xs text-faint">{v.absences.toLocaleString("en-US")} missed</div>
                    )}
                    {mixed && v.participationSource === "sef" && <div className="text-xs text-faint">SEF file</div>}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
