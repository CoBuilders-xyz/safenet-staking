import type { TFunction } from "i18next"
import { useTranslation } from "react-i18next"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { OverviewSection } from "@/components/overview/OverviewSection"
import { useValidatorActivity, type ValidatorActivity } from "@/hooks/useValidatorActivity"
import { explorerAddressUrl, explorerBlockUrl, explorerName, explorerTxUrl } from "@/lib/explorer"
import { formatTokenAmount, truncateAddress } from "@/lib/format"
import { dateTime, dayTick, longDay, shortDay } from "@/lib/utcDates"
import type { ValidatorEvent } from "@/lib/validatorActivity"
import type { Figure } from "@/lib/figure"
import { ChartFigure } from "./ChartFigure"

const DAY = 86_400

/** Events shown at first, and added by each "Show more". */
const HISTORY_PAGE = 25

const eventLabels = (t: TFunction): Record<ValidatorEvent["kind"], string> => ({
  registered: t("selector.registered", "Registered"),
  stake: t("selector.stake", "Stake"),
  "withdrawal-initiated": t("selector.unstakeStarted", "Unstake started"),
  "withdrawal-claimed": t("selector.claimed", "Withdrawal claimed"),
})

const count = (n: number) => n.toLocaleString("en-US")

/**
 * A link to the explorer, or the text alone when the chain has no explorer. The visible text is
 * shortened; the accessible name starts with it and says what the link opens, and the title holds
 * the full value.
 */
function ExplorerLink({ href, children, what, full }: { href: string | undefined; children: string; what?: string; full?: string }) {
  const { t } = useTranslation()
  if (!href) return <span className="font-mono">{children}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" title={full} className="font-mono text-primary underline-offset-2 hover:underline">
      {children}
      <span className="sr-only">{" "}{t("selector.explorerLink", "{{kind}} on {{explorer}}", { kind: what ?? "", explorer: explorerName ?? t("selector.explorer", "explorer") })}</span>
    </a>
  )
}

/**
 * The validator's record on the Staking contract and its delegators, then its event history, both
 * from one read of the Mainnet subgraph.
 */
export function ValidatorActivitySections({ address }: { address: string }) {
  const { activity } = useValidatorActivity(address)
  return (
    <>
      <DelegatorsSection activity={activity} />
      <EventHistorySection activity={activity} />
    </>
  )
}

function Pending({ figure, height }: { figure: Figure<unknown>; height: string }) {
  const { t } = useTranslation()
  if (figure.state === "loading") return <Skeleton className={`${height} w-full`} aria-label={t("overview.figure.loading", "Loading")} />
  if (figure.state === "unavailable") return <p className="text-sm text-muted-foreground">{t("overview.boundary.unavailable", "Unavailable. {{reason}}", { reason: figure.reason })}</p>
  return null
}


function DelegatorsSection({ activity }: { activity: Figure<ValidatorActivity> }) {
  const { t } = useTranslation()
  const a = activity.state === "ready" ? activity.value : undefined
  const source = a
    ? t("selector.delegatorSource", "Mainnet subgraph, block {{block}}. Non-zero stakes count as delegators. History replays stakes and withdrawals by UTC day; an unstake counts when it starts.", { block: count(a.block) })
    : t("selector.mainnetSource", "Mainnet subgraph.")
  return (
    <OverviewSection title={t("selector.delegatorTitle", "Delegators and registration")} source={source}>
      <Pending figure={activity} height="h-64" />
      {a && !a.validator && <p className="text-sm text-muted-foreground">{t("selector.noRecord", "The Mainnet subgraph has no record of this validator.")}</p>}
      {a?.validator && <DelegatorsBody activity={a} />}
    </OverviewSection>
  )
}

function DelegatorsBody({ activity }: { activity: ValidatorActivity }) {
  const { t } = useTranslation()
  const v = activity.validator!
  const registeredBlock = v.registeredAtBlock ? BigInt(v.registeredAtBlock) : undefined
  const { points } = activity.delegators
  // The line holds its last value to the block the subgraph has indexed.
  const indexedDay = Math.floor(activity.indexedAt / DAY) * DAY
  const last = points[points.length - 1]
  const data = [...points.map((p) => ({ x: p.day, delegators: p.current })), ...(last && last.day < indexedDay ? [{ x: indexedDay, delegators: last.current }] : [])]

  return (
    <div className="space-y-4">
      <dl className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-muted-foreground">{t("selector.delegatorsNow", "Delegators now")}</dt>
          <dd className="font-mono text-xl">{count(v.stakersCurrent)}</dd>
          <dd className="text-xs text-muted-foreground">{t("selector.everStakedCount", "{{n}} have ever staked", { n: count(v.stakersEver) })}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("selector.registered", "Registered")}</dt>
          {registeredBlock !== undefined && v.registeredAtTimestamp ? (
            <>
              <dd className="text-base">{longDay(Number(v.registeredAtTimestamp))}</dd>
              <dd className="text-xs text-muted-foreground">
                {t("selector.block", "Block")}{" "}
                <ExplorerLink href={explorerBlockUrl(registeredBlock)} what={t("selector.block", "Block")}>
                  {count(Number(registeredBlock))}
                </ExplorerLink>
              </dd>
            </>
          ) : (
            <dd className="text-muted-foreground">{t("selector.noRegistration", "No registration indexed")}</dd>
          )}
        </div>
        <div>
          <dt className="text-muted-foreground">{t("selector.stakingContract", "Staking contract")}</dt>
          <dd className="text-base">{v.isRegistered ? t("selector.registered", "Registered") : t("selector.notRegistered", "Not registered")}</dd>
          {!v.isRegistered && (
            <dd className="text-xs text-muted-foreground">
              {t("selector.deregistered", "The subgraph reports no current registration. It does not provide a deregistration date.")}
            </dd>
          )}
        </div>
      </dl>
      {!activity.replayMatches ? (
        <p className="text-sm text-muted-foreground">
          {t("selector.replayMismatch", "History is unavailable: replayed totals differ from the subgraph counters.")}
        </p>
      ) : points.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("selector.noStakes", "No address has staked with this validator.")}</p>
      ) : (
        <ChartFigure
          summary={t("selector.delegatorSummary", "Delegators: {{first}} on {{date}}, {{now}} now, at most {{max}}.", { first: count(points[0].current), date: shortDay(points[0].day), now: count(v.stakersCurrent), max: count(Math.max(...points.map((p) => p.current))) })}
          chart={{
            data,
            series: [{ key: "delegators", label: t("selector.delegators", "Delegators"), color: "var(--chart-1)" }],
            yDomain: [0, "auto"],
            formatY: (n) => count(n),
            formatTick: dayTick,
            formatTooltipX: shortDay,
            step: true,
          }}
          table={{
            columns: [t("selector.dayUtc", "Day (UTC)"), t("selector.delegators", "Delegators"), t("selector.everStaked", "Ever staked")],
            rows: [...points].reverse().map((p) => [shortDay(p.day), count(p.current), count(p.ever)]),
          }}
        />
      )}
    </div>
  )
}

function EventHistorySection({ activity }: { activity: Figure<ValidatorActivity> }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(HISTORY_PAGE)
  const a = activity.state === "ready" ? activity.value : undefined
  const source = a
    ? t("selector.eventsSource", "Mainnet subgraph, block {{block}}: indexed stakes, withdrawals, and latest registration. Block times use UTC.", { block: count(a.block) })
    : t("selector.mainnetSource", "Mainnet subgraph.")
  const events = a?.history ?? []

  return (
    <OverviewSection title={t("selector.eventHistory", "Event history")} source={source}>
      <Pending figure={activity} height="h-48" />
      {a && !a.validator && <p className="text-sm text-muted-foreground">{t("selector.noRecord", "The Mainnet subgraph has no record of this validator.")}</p>}
      {a?.validator && events.length === 0 && <p className="text-sm text-muted-foreground">{t("selector.noEvents", "No event is indexed for this validator.")}</p>}
      {events.length > 0 && (
        <>
          <div className="relative max-w-full overflow-x-auto" role="region" tabIndex={0} aria-label={t("selector.eventsNewest", "Event history, newest first")}>
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">{t("selector.eventsNewest", "Event history, newest first")}</caption>
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-[0.06em] text-faint">
                  <th scope="col" className="py-2.5 pr-3 text-left font-normal">{t("selector.whenUtc", "When (UTC)")}</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-normal">{t("selector.event", "Event")}</th>
                  <th scope="col" className="px-3 py-2.5 text-left font-normal">{t("selector.delegator", "Delegator")}</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-normal">SAFE</th>
                  <th scope="col" className="py-2.5 pl-3 text-right font-normal">{t("selector.onChain", "On chain")}</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, shown).map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{dateTime(e.timestamp).replace(/ UTC$/, "")}</td>
                    <td className="px-3 py-2">{eventLabels(t)[e.kind]}</td>
                    <td className="px-3 py-2">
                      {"staker" in e ? (
                        <ExplorerLink href={explorerAddressUrl(e.staker)} what={t("selector.delegator", "Delegator")} full={e.staker}>
                          {truncateAddress(e.staker)}
                        </ExplorerLink>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{"amount" in e ? formatTokenAmount(e.amount, 18, 2) : "—"}</td>
                    <td className="py-2 pl-3 text-right">
                      {"txHash" in e ? (
                        <ExplorerLink href={explorerTxUrl(e.txHash)} what={t("selector.transaction", "Transaction")} full={e.txHash}>
                          {truncateAddress(e.txHash)}
                        </ExplorerLink>
                      ) : (
                        <ExplorerLink href={explorerBlockUrl(e.block)}>
                          {t("selector.blockNumber", "Block {{n}}", { n: count(Number(e.block)) })}
                        </ExplorerLink>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
            <span>
              {t("selector.eventsCount", "{{shown}} of {{total}} events, newest first", { shown: count(Math.min(shown, events.length)), total: count(events.length) })}
            </span>
            {shown < events.length && (
              <Button variant="outline" size="sm" onClick={() => setShown((n) => n + HISTORY_PAGE)}>
                {t("selector.showMore", "Show {{n}} more", { n: Math.min(HISTORY_PAGE, events.length - shown) })}
              </Button>
            )}
          </div>
        </>
      )}
    </OverviewSection>
  )
}
