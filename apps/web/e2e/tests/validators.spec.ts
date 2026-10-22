import { test, expect } from "../fixtures/base.fixture"
import { ValidatorsPage } from "../pages/validators.page"

test.describe("Validators Page", () => {
  test("renders heading and subtitle", async ({ disconnectedPage: page }) => {
    const validators = new ValidatorsPage(page)
    await validators.goto()

    await expect(validators.heading).toBeVisible()
    await expect(validators.subtitle).toBeVisible()
  })

  test("displays validator cards", async ({ disconnectedPage: page }) => {
    const validators = new ValidatorsPage(page)
    await validators.goto()

    // Wait for validators to load — look for known validator names
    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("link", { name: "Validator B" })).toBeVisible()
  })

  test("validator cards show stake/unstake buttons when connected", async ({ connectedPage: page }) => {
    const validators = new ValidatorsPage(page)
    await validators.goto()

    // Wait for validator cards to render
    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })

    // Should see Stake buttons
    const stakeButtons = page.getByRole("button", { name: "Stake" })
    await expect(stakeButtons.first()).toBeVisible()

    // Should see Unstake buttons (may be disabled if no stake yet)
    const unstakeButtons = page.getByRole("button", { name: "Unstake" })
    await expect(unstakeButtons.first()).toBeVisible()
  })

  test("a rate SEF publishes as null reads Not published, never 0.00%", async ({ disconnectedPage: page, mockChainState }) => {
    // validator-info.json as live on 2026-10-22: every rate null.
    mockChainState.sefValidators = mockChainState.sefValidators.map((v) => ({ ...v, participation_rate_14d: null }))
    const validators = new ValidatorsPage(page)
    await validators.goto()

    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })
    // One per card: A and B, and C, which SEF lists as withdrawn.
    await expect(page.getByText("Not published")).toHaveCount(3)
    await expect(page.getByText("If a validator's participation is below 75% in a reward period", { exact: false })).toBeVisible()
    await expect(page.getByText(/^0(\.00)?%$/)).toHaveCount(0)
    await expect(page.getByRole("button", { name: /reward threshold/ })).toHaveCount(0)
  })

  test("validator card links to detail page", async ({ disconnectedPage: page }) => {
    const validators = new ValidatorsPage(page)
    await validators.goto()

    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })

    await page.getByRole("link", { name: "Validator A" }).click()
    await expect(page).toHaveURL(/\/validators\/0x/)
  })
})
