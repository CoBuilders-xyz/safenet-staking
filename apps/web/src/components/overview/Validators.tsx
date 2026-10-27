import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import type { Address } from "viem"
import { ParticipationRate } from "@/components/validators/ParticipationRate"
import { formatParticipation, formatTokenAmount, truncateAddress } from "@/lib/format"

export interface ValidatorTableRow {
  address: Address
  label: string | undefined
  stake: bigint
  share: number
  /** Addresses staking with this validator now. Undefined when the source does not have it. */
  stakers: number | undefined
  /**
   * Fraction of attestation ceremonies attended. Undefined when no source has it, including a
   * row from SEF's file that lists the validator with a null rate.
   */
  participation: number | undefined
  /** Where this row's participation comes from, or would: "sef" with no rate is SEF's null. */
  participationSource?: "subgraph" | "sef"
  /** Ceremonies missed in the same window. Only the subgraph counts them. */
  absences: bigint | undefined
  /** From SEF's `is_active` flag; "unlisted" when SEF's list does not carry it. Undefined until the list loads. */
  status?: "active" | "withdrawn" | "unlisted"
}

/**
 * Validators by stake. Participation shows the rate and, when the subgraph has it, the raw count
 * of missed ceremonies: the count is what a staker can act on. A rate beside a missed count is
 * floored, so it never reads 100.00% above "2 missed".
 *
 * A withdrawn validator keeps its stake and its past participation, says it is withdrawn, and
 * offers no way to stake with it. An active one links to staking with it.
 */
export function Validators({ rows }: { rows: readonly ValidatorTableRow[] }) {
  const { t } = useTranslation()
  const showStakers = rows.some((r) => r.stakers !== undefined)
  // Mark the source per row only when the rows mix sources; otherwise the caption says it.
  const mixed = new Set(rows.map((r) => r.participationSource).filter(Boolean)).size > 1
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-faint">
            <th scope="col" className="py-2.5 pr-3 text-left font-normal">{t("overview.validators.column.validator", "Validator")}</th>
            <th scope="col" className="px-3 py-2.5 text-right font-normal">{t("overview.validators.column.staked", "Staked")}</th>
            <th scope="col" className="px-3 py-2.5 text-right font-normal">{t("overview.validators.column.share", "Share")}</th>
            {showStakers && <th scope="col" className="px-3 py-2.5 text-right font-normal">{t("overview.validators.column.stakers", "Stakers")}</th>}
            <th scope="col" className="px-3 py-2.5 text-right font-normal">{t("overview.validators.column.participation", "Participation")}</th>
            <th scope="col" className="py-2.5 pl-3 text-right font-normal">{t("overview.validators.column.status", "Status")}</th>
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
              <td className="px-3 py-3 text-right font-mono tabular-nums">
                {v.participation === undefined ? (
                  <span className="text-muted-foreground">
                    {v.participationSource === "sef"
                      ? t("programme.rateNotPublished", "Not published")
                      : t("overview.validators.notAvailable", "Not available")}
                  </span>
                ) : (
                  <>
                    <ParticipationRate rate={v.participation} text={formatParticipation(v.participation, v.absences)} />
                    {v.absences !== undefined && (
                      <div className="text-xs text-faint">
                        {t("overview.validators.missed", "{{n}} missed", {
                          count: Number(v.absences),
                          n: v.absences.toLocaleString("en-US"),
                        })}
                      </div>
                    )}
                    {mixed && v.participationSource === "sef" && <div className="text-xs text-faint">{t("overview.validators.sefFile", "SEF file")}</div>}
                  </>
                )}
              </td>
              <td className="py-3 pl-3 text-right">
                {v.status === "withdrawn" ? (
                  <span className="text-xs text-warning">
                    {t("programme.withdrawnStatus", "Withdrawn, Aegis participation unconfirmed")}
                  </span>
                ) : v.status === "active" ? (
                  <span className="inline-flex items-center gap-3">
                    <span className="text-xs text-success">{t("overview.validators.active", "Active")}</span>
                    <Link
                      to={`/validators?delegate=${v.address}`}
                      aria-label={t("overview.validators.stakeWith", "Stake with {{name}}", { name: v.label ?? truncateAddress(v.address) })}
                      className="text-xs font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {t("overview.validators.stake", "Stake")}
                    </Link>
                  </span>
                ) : v.status === "unlisted" ? (
                  <span className="text-xs text-muted-foreground">{t("overview.validators.unlisted", "Not in SEF's list")}</span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
