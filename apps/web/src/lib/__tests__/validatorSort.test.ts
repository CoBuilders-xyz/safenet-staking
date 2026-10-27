import { describe, it, expect } from "vitest"
import { sortAndFilter, type SortableValidator } from "../validatorSort"

const row = (name: string, v: Partial<SortableValidator>) => ({
  name,
  isActive: true,
  stake: undefined,
  participation: null,
  delegators: undefined,
  ...v,
})

const rows = [
  row("a", { stake: 10n, participation: 99.5, delegators: 4 }),
  row("b", { stake: 30n, participation: null, delegators: 9, isActive: false }),
  row("c", { stake: undefined, participation: 100, delegators: undefined }),
  row("d", { stake: 20n, participation: 11.2, delegators: 9 }),
]
const names = (r: { name: string }[]) => r.map((x) => x.name)

describe("sortAndFilter", () => {
  it("sorts by stake, largest first, with an unknown stake last", () => {
    expect(names(sortAndFilter(rows, "stake", "all"))).toEqual(["b", "d", "a", "c"])
  })

  it("sorts by SEF's rate, with a rate SEF does not publish last", () => {
    expect(names(sortAndFilter(rows, "participation", "all"))).toEqual(["c", "a", "d", "b"])
  })

  it("sorts by delegators and keeps SEF's order on a tie", () => {
    expect(names(sortAndFilter(rows, "delegators", "all"))).toEqual(["b", "d", "a", "c"])
  })

  it("keeps only active validators when asked, and leaves the input alone", () => {
    expect(names(sortAndFilter(rows, "stake", "active"))).toEqual(["d", "a", "c"])
    expect(names(rows)).toEqual(["a", "b", "c", "d"])
  })
})
