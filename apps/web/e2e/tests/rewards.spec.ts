import { test, expect } from "../fixtures/base.fixture"
import { REWARD_PROOFS } from "../fixtures/test-data"
import type { Page } from "@playwright/test"

/** The "Claimable SAFE" label and amount live in the same container as the link to the Rewards page. */
function rewardsRow(page: Page) {
  return page.getByText("Claimable SAFE").locator("..")
}

// The dashboard keeps its claimable banner; claiming itself happens on the Rewards page,
// covered by rewards-page.spec.ts.
test.describe("Dashboard rewards banner", () => {
  test("shows zero when the address has no reward proof", async ({ connectedPage: page }) => {
    // Default mockChainState.rewardProof is undefined -> proof endpoint 404s
    await page.goto("/")

    const row = rewardsRow(page)
    await expect(row).toBeVisible({ timeout: 10_000 })
    await expect(row.getByText("0", { exact: true })).toBeVisible()
  })

  test("shows the claimable amount and links to the Rewards page", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/")

    const row = rewardsRow(page)
    await expect(row.getByText("100", { exact: true })).toBeVisible({ timeout: 10_000 })
    await page.getByRole("link", { name: "Go to Rewards" }).click()

    await expect(page).toHaveURL(/#\/rewards$/)
    await expect(page.getByRole("heading", { name: "Rewards", exact: true })).toBeVisible()
  })

  test("shows a compliance note when part of the reward is pending KYC", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.partialKyc

    await page.goto("/")

    await expect(rewardsRow(page)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/pending compliance checks/)).toBeVisible({ timeout: 10_000 })
  })
})
