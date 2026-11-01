import type { TFunction } from "i18next"
export type SortKey = "stake" | "participation" | "delegators"
export type ListFilter = "all" | "active"

export const sortOptions = (t: TFunction): readonly { key: SortKey; label: string }[] => [
  { key: "stake", label: t("selector.totalSafe", "Total SAFE") },
  { key: "participation", label: t("selector.participation", "Participation") },
  { key: "delegators", label: t("selector.delegators", "Delegators") },
]

export const filterOptions = (t: TFunction): readonly { key: ListFilter; label: string }[] => [
  { key: "all", label: t("selector.all", "All") },
  { key: "active", label: t("selector.activeOnly", "Active only") },
]

export interface SortableValidator {
  isActive: boolean
  stake: bigint | undefined
  /** SEF's published rate. Null when SEF publishes none. */
  participation: number | null
  delegators: number | undefined
}

function compare(a: SortableValidator, b: SortableValidator, key: SortKey): number {
  const value = (v: SortableValidator) =>
    key === "stake" ? v.stake : key === "participation" ? (v.participation ?? undefined) : v.delegators
  const x = value(a)
  const y = value(b)
  // A missing value sorts last, whichever way the known ones go.
  if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? 1 : -1
  return x === y ? 0 : x > y ? -1 : 1
}

/**
 * Largest first by the chosen key. A validator without the figure goes last, and ties keep SEF's
 * order. "Active" is SEF's `is_active` flag, the status every card shows.
 */
export function sortAndFilter<T extends SortableValidator>(rows: readonly T[], key: SortKey, filter: ListFilter): T[] {
  return rows.filter((r) => filter === "all" || r.isActive).sort((a, b) => compare(a, b, key))
}
