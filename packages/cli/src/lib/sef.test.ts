import { test } from "node:test"
import assert from "node:assert/strict"
import type {
  RewardsAttempt, RewardsDataBase, RewardsEnsState, SefValidator as CoreSefValidator,
} from "@cobuilders/safenet-core"
import type { RewardsSourceUsed, SefValidator } from "./sef.js"

// Enforced by tsc in `pnpm check`: `pnpm test` runs this through tsx, which strips types.
/** True only when each type is assignable to the other, so a field added, dropped or retyped fails. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

test("the library's SefValidator is core's, field for field", () => {
  const same: Same<SefValidator, CoreSefValidator> = true
  const sameKeys: Same<keyof SefValidator, keyof CoreSefValidator> = true
  assert.ok(same && sameKeys)
})

test("the library's rewards source names core's kinds and ENS states, no more and no fewer", () => {
  const kinds: Same<RewardsSourceUsed["kind"], RewardsDataBase["kind"]> = true
  const states: Same<RewardsSourceUsed["ens"]["status"], RewardsEnsState["status"]> = true
  const outcomes: Same<RewardsSourceUsed["tried"][number]["outcome"], RewardsAttempt["outcome"]> = true
  const triedKinds: Same<RewardsSourceUsed["tried"][number]["kind"], RewardsDataBase["kind"]> = true
  assert.ok(kinds && states && outcomes && triedKinds)
})
