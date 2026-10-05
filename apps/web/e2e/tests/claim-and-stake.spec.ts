import { test, expect } from "../fixtures/base.fixture"
import { AMOUNTS, OTHER_MERKLE_ROOT, REWARD_PROOFS, VALIDATORS } from "../fixtures/test-data"
import type { Locator, Page } from "@playwright/test"

// Default mock state: 1,000 SAFE in the wallet, an unlimited allowance, 300 SAFE staked with
// Validator A. REWARD_PROOFS.claimable makes 100 SAFE claimable under the root on chain.

const SAFE = 10n ** 18n
const VALIDATOR_A = "Validator A · 5% commission"

function actions(page: Page): Locator {
  return page.getByRole("region", { name: "Actions" })
}

function stakeOf(state: { stakes: Map<string, bigint> }, validator: string): bigint {
  return state.stakes.get(validator.toLowerCase()) ?? 0n
}

/** Opens Claim & Stake and confirms the claim. Returns the dialog, now on the stake step. */
async function claimFromDialog(page: Page): Promise<Locator> {
  const primary = actions(page).getByRole("button", { name: "Claim & Stake" })
  await expect(primary).toBeEnabled({ timeout: 10_000 })
  await primary.click()

  const dialog = page.getByRole("dialog")
  await expect(dialog.getByRole("heading", { name: "Claim & Stake" })).toBeVisible()
  await dialog.getByRole("button", { name: "Claim 100 SAFE" }).click()
  await expect(dialog.getByText("Claimed 100 SAFE. It is in your wallet now.", { exact: false })).toBeVisible({
    timeout: 10_000,
  })
  return dialog
}

test.describe("Claim & Stake", () => {
  test("in a Safe: claims, then approves and stakes the claimed amount in one batch", async ({
    batchingPage: page,
    mockChainState,
  }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    mockChainState.allowance = 0n
    const before = stakeOf(mockChainState, VALIDATORS.validatorA)

    await page.goto("/#/rewards")
    const dialog = await claimFromDialog(page)

    // Pre-filled with what the claim's transfer paid, not typed by the user.
    await expect(dialog.getByLabel("Amount")).toHaveValue("100")
    await dialog.getByLabel("Validator").selectOption({ label: VALIDATOR_A })
    // One button, no separate approval: the batch carries approve and stake together.
    await expect(dialog.getByRole("button", { name: /Approve/ })).toHaveCount(0)
    await dialog.getByRole("button", { name: "Stake" }).click()

    await expect(dialog.getByText("Staked 100 SAFE with Validator A.")).toBeVisible({ timeout: 10_000 })
    expect(stakeOf(mockChainState, VALIDATORS.validatorA) - before).toBe(100n * SAFE)
    expect(mockChainState.balance).toBe(AMOUNTS.userBalance)
  })

  test("without batching: approves, then stakes, as two transactions", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    mockChainState.allowance = 0n
    const before = stakeOf(mockChainState, VALIDATORS.validatorA)

    await page.goto("/#/rewards")
    const dialog = await claimFromDialog(page)
    await dialog.getByLabel("Validator").selectOption({ label: VALIDATOR_A })

    await dialog.getByRole("button", { name: "Approve exact amount" }).click()
    const stake = dialog.getByRole("button", { name: "Stake" })
    await expect(stake).toBeEnabled({ timeout: 10_000 })
    expect(mockChainState.allowance).toBe(100n * SAFE)
    await stake.click()

    await expect(dialog.getByText("Staked 100 SAFE with Validator A.")).toBeVisible({ timeout: 10_000 })
    expect(stakeOf(mockChainState, VALIDATORS.validatorA) - before).toBe(100n * SAFE)
  })

  test("allowance already sufficient: skips approval; a reduced amount leaves the rest in the wallet", async ({
    connectedPage: page,
    mockChainState,
  }) => {
    // The default allowance is unlimited.
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    const before = stakeOf(mockChainState, VALIDATORS.validatorB)

    await page.goto("/#/rewards")
    const dialog = await claimFromDialog(page)
    await dialog.getByLabel("Validator").selectOption({ label: "Validator B · 3% commission" })
    await expect(dialog.getByRole("button", { name: /Approve/ })).toHaveCount(0)

    await dialog.getByLabel("Amount").fill("60")
    await expect(dialog.getByText("40 SAFE stays in your wallet, not staked.")).toBeVisible()
    await dialog.getByRole("button", { name: "Stake" }).click()

    await expect(dialog.getByText("Staked 60 SAFE with Validator B. 40 SAFE stays in your wallet.")).toBeVisible({
      timeout: 10_000,
    })
    expect(stakeOf(mockChainState, VALIDATORS.validatorB) - before).toBe(60n * SAFE)
    expect(mockChainState.balance).toBe(AMOUNTS.userBalance + 40n * SAFE)
  })

  test("abandoned after the claim: says where the SAFE is, then offers to stake the balance", async ({
    connectedPage: page,
    mockChainState,
  }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")
    const dialog = await claimFromDialog(page)

    await page.keyboard.press("Escape")
    await expect(dialog.getByRole("alert")).toContainText("Your 100 SAFE is in your wallet and is not staked.")
    await dialog.getByRole("button", { name: "Close anyway" }).click()
    await expect(page.getByRole("dialog")).not.toBeVisible()

    // Nothing left to claim, so the primary action stakes what is in the wallet.
    const stakeBalance = actions(page).getByRole("button", { name: "Stake your balance" })
    await expect(stakeBalance).toBeVisible({ timeout: 10_000 })
    await expect(actions(page).getByRole("button", { name: "Claim", exact: true })).toBeDisabled()
    await stakeBalance.click()

    const reopened = page.getByRole("dialog")
    await expect(reopened.getByRole("heading", { name: "Stake your balance" })).toBeVisible()
    await expect(reopened.getByLabel("Amount")).toHaveValue("1100")
    await reopened.getByLabel("Validator").selectOption({ label: VALIDATOR_A })
    await reopened.getByRole("button", { name: "Stake" }).click()
    await expect(reopened.getByText("Staked 1,100 SAFE with Validator A.")).toBeVisible({ timeout: 10_000 })
  })

  test("root updated between fetch and submit: explains, reloads the proof, and claims again", async ({
    connectedPage: page,
    mockChainState,
  }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")
    const primary = actions(page).getByRole("button", { name: "Claim & Stake" })
    await expect(primary).toBeEnabled({ timeout: 10_000 })

    // The page has its proof. Now SEF publishes a new epoch and the root moves on chain.
    mockChainState.merkleRoot = OTHER_MERKLE_ROOT
    mockChainState.rewardProof = {
      ...REWARD_PROOFS.claimable,
      cumulativeAmount: (150n * SAFE).toString(),
      merkleRoot: OTHER_MERKLE_ROOT,
    }

    await primary.click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "Claim 100 SAFE" }).click()

    await expect(dialog.getByRole("alert")).toContainText("The rewards root changed on chain")
    // The contract refused it, so nothing was paid.
    expect(mockChainState.merkleDropClaimed).toBe(0n)

    await dialog.getByRole("button", { name: "Reload proof and retry" }).click()
    await expect(dialog.getByText("Claimed 150 SAFE. It is in your wallet now.", { exact: false })).toBeVisible({
      timeout: 10_000,
    })
    expect(mockChainState.merkleDropClaimed).toBe(150n * SAFE)
  })
})
