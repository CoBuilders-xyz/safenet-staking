import { test } from "node:test"
import assert from "node:assert/strict"
import type { SefValidator as CoreSefValidator } from "@cobuilders/safenet-core"
import type { SefValidator } from "./sef.js"

/** True only when each type is assignable to the other, so a field added, dropped or retyped fails. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

test("the library's SefValidator is core's, field for field", () => {
  const same: Same<SefValidator, CoreSefValidator> = true
  const sameKeys: Same<keyof SefValidator, keyof CoreSefValidator> = true
  assert.ok(same && sameKeys)
})
