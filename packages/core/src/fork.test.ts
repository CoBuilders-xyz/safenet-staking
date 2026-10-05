import { test } from "node:test"
import assert from "node:assert/strict"
import { CONTRACTS, SEF_DATA } from "./contracts.js"
import { MAINNET_FORK, MAINNET_FORK_SEF_DATA } from "./fork.js"

test("the fork block sits after every Mainnet contract the suite uses", () => {
  for (const name of ["staking", "merkleDrop"] as const) {
    assert.ok(MAINNET_FORK.blockNumber > CONTRACTS[name].deployBlock, `${name} is not deployed at the fork block`)
  }
})

test("SEF's data is pinned to a full commit, not a branch", () => {
  // A branch name would move under the pinned block and break the proofs at the next root.
  assert.match(MAINNET_FORK.sefData.commit, /^[0-9a-f]{40}$/)
})

test("the pinned SEF URLs keep the layout of the live ones", () => {
  const live = (url: string) => url.replace(/\/main\//, `/${MAINNET_FORK.sefData.commit}/`)
  assert.equal(MAINNET_FORK_SEF_DATA.validatorInfo, live(SEF_DATA.validatorInfo))
  assert.equal(MAINNET_FORK_SEF_DATA.rewardsProofBase, live(SEF_DATA.rewardsProofBase))
})
