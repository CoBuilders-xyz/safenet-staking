import { useTranslation } from "react-i18next"
import { useRewardHistory } from "@/hooks/useRewardHistory"
import { REWARD_HISTORY_CLAIM_LIMIT, REWARD_HISTORY_PERIOD_LIMIT } from "@/lib/rewardHistory"
import { formatTokenAmount } from "@/lib/format"
import { explorerTxUrl } from "@/lib/explorer"
import { RewardsSection, SectionError, SectionLoading, SectionNote } from "./RewardsSection"

export function RewardHistorySection() {
  const { t } = useTranslation()
  const { state, address, refetch } = useRewardHistory()
  const title = t("rewardHistory.title", "Your claims by distribution period")
  const failure = state.status === "incomplete"
    ? t("rewardHistory.incomplete", "History is incomplete or inconsistent. Amounts are unknown; no totals are shown.")
    : state.status === "stale"
      ? t("rewardHistory.stale", "The index is stale or unhealthy. History is unavailable.")
      : t("rewardHistory.unavailable", "History is unavailable. The subgraph or historical Ethereum reads could not be verified.")
  return (
    <RewardsSection title={title} source={t("rewardHistory.source", "Source: Mainnet subgraph claims, checked against your cumulative claims on Ethereum at each window boundary.")}>
      <SectionNote>{t("rewardHistory.meaning", "These are payments you claimed during each root's lifetime, not rewards earned in that period. Per-period earnings are unknown.")}</SectionNote>
      <SectionNote>{t("rewardHistory.limits", "Latest {{periods}} distributions only, up to {{claims}} claims in that range. Older history is excluded. A full page is incomplete.", { periods: REWARD_HISTORY_PERIOD_LIMIT, claims: REWARD_HISTORY_CLAIM_LIMIT - 1 })}</SectionNote>
      <SectionNote>{t("rewardHistory.order", "Windows use whole blocks. Claims before a root update in the same block enter the new window. Exact event-order attribution is unavailable.")}</SectionNote>
      {state.status === "disconnected" && <p>{t("rewardHistory.connect", "Connect a wallet to view its claim history.")}</p>}
      {address && <p className="break-all font-mono text-xs">{address}</p>}
      {state.status === "loading" && <SectionLoading />}
      {(state.status === "unavailable" || state.status === "incomplete" || state.status === "stale") && (
        <SectionError message={failure} onRetry={() => { void refetch() }} />
      )}
      {state.status === "ready" && <>
        <SectionNote>{t("rewardHistory.asOf", "Through indexed block {{block}}. Showing distributions {{from}}–{{to}} of {{total}}.", {
          block: state.data.freshness.block, from: state.data.rows.at(-1)!.period,
          to: state.data.rows[0]!.period, total: state.data.totalPeriods,
        })}</SectionNote>
        <div role="region" aria-label={title} tabIndex={0} className="max-w-full overflow-x-auto rounded-md border focus-visible:outline-2 focus-visible:outline-ring">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{title}</caption>
            <thead><tr className="border-b">
              <th scope="col" className="p-3">{t("rewardHistory.period", "Distribution")}</th>
              <th scope="col" className="p-3">{t("rewardHistory.date", "Root set (UTC)")}</th>
              <th scope="col" className="p-3">{t("rewardHistory.blocks", "Block window")}</th>
              <th scope="col" className="p-3">{t("rewardHistory.claims", "Claims")}</th>
              <th scope="col" className="p-3">{t("rewardHistory.amount", "Claimed (SAFE)")}</th>
            </tr></thead>
            <tbody>{state.data.rows.map((row) => {
              const url = explorerTxUrl(row.transaction)
              return <tr key={row.period} className="border-b last:border-0">
                <th scope="row" className="p-3">
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4"
                    aria-label={t("rewardHistory.transaction", "Distribution {{period}} transaction", { period: row.period })}>{row.period}</a> : row.period}
                </th>
                <td className="whitespace-nowrap p-3">{new Date(row.timestamp * 1000).toISOString().replace("T", " ").replace(".000Z", "")}</td>
                <td className="whitespace-nowrap p-3 font-mono">{row.startBlock.toString()}–{row.endBlock.toString()}</td>
                <td className="p-3">{row.claims}</td>
                <td className="whitespace-nowrap p-3 font-mono">{formatTokenAmount(row.claimed, 18, 18)}</td>
              </tr>
            })}</tbody>
          </table>
        </div>
      </>}
    </RewardsSection>
  )
}
