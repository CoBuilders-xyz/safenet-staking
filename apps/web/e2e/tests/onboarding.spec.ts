/**
 * Contextual onboarding: each term explained where it appears, and the "what happens if" step
 * between Stake and the wallet's confirmation. One test per flow.
 */
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"
import { REWARD_PROOFS, VALIDATORS } from "../fixtures/test-data"

/** Where each term appears, and words its explanation must hold. */
const TERMS_BY_SCREEN = [
  { path: "/", terms: [["Safenet", "transaction-security network"], ["staking", "staking contract behind a validator"]] },
  { path: "/#/dashboard", terms: [["Safenet", "transaction-security network"], ["staking", "staking contract behind a validator"]] },
  { path: "/#/validators", terms: [["validator", "attests results"], ["stake", "staking contract behind a validator"], ["Commission", "validator keeps"]] },
  { path: `/#/validators/${VALIDATORS.validatorA}`, terms: [["Commission", "validator keeps"]] },
  // The mocked staking contract's withdrawDelay is seven days.
  { path: "/#/withdrawals", terms: [["withdrawals", "for 7 days"]] },
  { path: "/#/rewards", terms: [["rewards", "A claim collects everything not yet claimed"]] },
] as const

async function explain(page: Page, name: string) {
  const term = page.getByRole("button", { name, exact: true }).first()
  await term.click()
  const tooltip = page.getByRole("tooltip")
  await expect(tooltip).toBeVisible()
  return { term, tooltip }
}

test.describe("Contextual onboarding", () => {
  test("browsing: every term opens its explanation where it appears, and Escape closes it", async ({ connectedPage: page }) => {
    for (const { path, terms } of TERMS_BY_SCREEN) {
      await page.goto(path)
      await expect(page.getByRole("button", { name: terms[0][0], exact: true }).first()).toBeVisible({ timeout: 10_000 })
      for (const [name, words] of terms) {
        const { tooltip } = await explain(page, name)
        await expect(tooltip, `${path}: ${name}`).toContainText(words)
        await page.keyboard.press("Escape")
        await expect(tooltip).toHaveCount(0)
      }
    }
  })

  test("delegating: Stake shows what happens if, Back returns, and only Confirm sends", async ({ connectedPage: page, mockChainState }) => {
    const before = mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase()) ?? 0n
    await page.goto(`/#/validators?delegate=${VALIDATORS.validatorA}`)
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Amount").fill("25")
    await dialog.getByRole("button", { name: "Stake", exact: true }).click()

    const review = dialog.getByRole("region", { name: "Before you stake 25 SAFE with Validator A" })
    await expect(review).toBeVisible()
    for (const question of [
      "…I want my SAFE back?",
      "…I want to move to another validator?",
      "…this validator's participation drops?",
      "…something goes wrong?",
      "…rewards are lower than I expect?",
    ]) {
      await expect(review.getByText(question)).toBeVisible()
    }
    // The unstaking period is the staking contract's, explained in place.
    const { tooltip } = await explain(page, "7 days")
    await expect(tooltip).toContainText("earns no rewards and cannot be moved")
    await page.keyboard.press("Escape")
    expect(mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase())).toBe(before)

    await review.getByRole("button", { name: "Back" }).click()
    await expect(dialog.getByLabel("Amount")).toHaveValue("25")
    await dialog.getByRole("button", { name: "Stake", exact: true }).click()
    await dialog.getByRole("button", { name: "Confirm stake" }).click()

    await expect(page.getByText("Delegation successful")).toBeVisible({ timeout: 10_000 })
    expect(mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase())).toBe(before + 25n * 10n ** 18n)
  })

  test("claim & stake: the review names what the claim paid before the stake is sent", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    await page.goto("/#/rewards")
    await page.getByRole("region", { name: "Actions" }).getByRole("button", { name: "Claim & Stake" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: /^Claim .* SAFE$/ }).click()
    await expect(dialog.getByLabel("Amount")).toHaveValue("100", { timeout: 10_000 })
    await dialog.getByLabel("Validator").selectOption({ label: "Validator A · 5% commission" })
    await dialog.getByRole("button", { name: "Stake", exact: true }).click()

    await expect(dialog.getByRole("region", { name: "Before you stake 100 SAFE with Validator A" })).toBeVisible()
    // The validator is chosen before the review, which names it.
    await expect(dialog.getByLabel("Validator", { exact: true })).toHaveCount(0)
    await dialog.getByRole("button", { name: "Confirm stake" }).click()
    await expect(dialog.getByText("Staked 100 SAFE with Validator A.")).toBeVisible({ timeout: 10_000 })
  })
})

test.describe("Contextual onboarding on a touch screen", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } })

  test("a tap opens a term's explanation and a second tap closes it", async ({ connectedPage: page }) => {
    await page.goto("/#/validators")
    const term = page.getByRole("button", { name: "Commission", exact: true }).first()
    await expect(term).toBeVisible({ timeout: 10_000 })

    await term.tap()
    await expect(page.getByRole("tooltip")).toContainText("validator keeps")
    await term.tap()
    await expect(page.getByRole("tooltip")).toHaveCount(0)
  })
})
