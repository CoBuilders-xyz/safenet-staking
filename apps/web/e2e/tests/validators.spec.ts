import { test, expect } from "../fixtures/base.fixture"
import { ValidatorsPage } from "../pages/validators.page"
import { VALIDATORS } from "../fixtures/test-data"

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
    // validator-info.json as SEF published it from cce3fc2, 2026-10-20 09:01 UTC, until 88bf9d9, 2026-10-22 14:33 UTC: every rate null.
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

test.describe("Validators Page: selector", () => {
  const cardNames = async (page: import("@playwright/test").Page) =>
    page.getByRole("link", { name: /^Validator [ABC]$/ }).allTextContents()

  test("sorts by stake, participation and delegators, and filters to active validators", async ({ disconnectedPage: page, mockChainState }) => {
    // SEF's rates in reverse of its order, so each sort gives a different order.
    mockChainState.sefValidators = mockChainState.sefValidators.map((v) => ({
      ...v,
      participation_rate_14d: { [VALIDATORS.validatorA]: 0.5, [VALIDATORS.validatorB]: 0.9, [VALIDATORS.validatorC]: 0.99 }[v.address] ?? null,
    }))
    const validators = new ValidatorsPage(page)
    await validators.goto()
    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })

    const sortBy = page.getByRole("group", { name: "Sort by" })
    await expect(sortBy.getByRole("button", { name: "Total SAFE" })).toHaveAttribute("aria-pressed", "true")
    // A and B hold 5,000 SAFE each on the mocked contract, C nothing: a tie keeps SEF's order.
    expect(await cardNames(page)).toEqual(["Validator A", "Validator B", "Validator C"])

    await sortBy.getByRole("button", { name: "Participation" }).click()
    await expect.poll(() => cardNames(page)).toEqual(["Validator C", "Validator B", "Validator A"])

    await sortBy.getByRole("button", { name: "Delegators" }).click()
    await expect.poll(() => cardNames(page)).toEqual(["Validator A", "Validator B", "Validator C"])

    await page.getByRole("group", { name: "Show" }).getByRole("button", { name: "Active only" }).click()
    await expect.poll(() => cardNames(page)).toEqual(["Validator A", "Validator B"])
  })

  test("shows delegators, registration and Aegis misses on each card, and names every source", async ({ disconnectedPage: page }) => {
    const validators = new ValidatorsPage(page)
    await validators.goto()
    const card = validators.getValidatorCard("Validator B")
    await expect(card.getByText("Delegators:")).toBeVisible({ timeout: 15_000 })

    await expect(card.getByText("12", { exact: true })).toBeVisible()
    await expect(card.getByText("26 Mar 2026")).toBeVisible()
    await expect(card.getByText("Missed, last 14 days")).toBeVisible()
    // 10 a day over the 14 complete Beta days of the consensus window.
    await expect(card.getByText("140", { exact: true })).toBeVisible()
    await expect(page.getByText(/Delegators and registration: the Mainnet subgraph/)).toBeVisible()
    await expect(page.getByText(/Gnosis subgraph, Aegis, 14 complete UTC days/)).toBeVisible()
    await expect(page.getByText("Names: SEF labels. No ENS primary name is set.")).toBeVisible()
  })

  test("names a validator by its ENS primary name when one is set, and says so", async ({ disconnectedPage: page, mockChainState }) => {
    mockChainState.ensNames = { [VALIDATORS.validatorA]: "validator-a.eth" }
    const validators = new ValidatorsPage(page)
    await validators.goto()

    await expect(page.getByRole("link", { name: "validator-a.eth" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("ENS · SEF: Validator A")).toBeVisible()
    await expect(page.getByRole("link", { name: "Validator B" })).toBeVisible()
    await expect(page.getByText(/^Names: ENS primary names, verified by reverse resolution/)).toBeVisible()
  })

  test("says why delegators and misses are missing when both subgraphs fail", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.mainnet = "fail"
    mockSubgraph.gnosis = "fail"
    const validators = new ValidatorsPage(page)
    await validators.goto()
    await expect(page.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })

    await expect(page.getByText(/Delegators and registration: unavailable\. The subgraph could not be queried\./)).toBeVisible()
    await expect(page.getByText(/Missed ceremonies unavailable\./)).toBeVisible()
    await expect(validators.getValidatorCard("Validator A").getByText("—")).toHaveCount(3)
  })
})
