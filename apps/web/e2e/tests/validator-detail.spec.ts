import { test, expect } from "../fixtures/base.fixture"
import { ValidatorDetailPage } from "../pages/validator-detail.page"
import { VALIDATORS } from "../fixtures/test-data"

test.describe("Validator Detail Page", () => {
  test("shows validator info for known validator", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("Validator A", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Active")).toBeVisible()
  })

  test("shows commission and uptime metadata", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("Validator A", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Commission:.*5%/)).toBeVisible()
    await expect(page.getByText(/Participation.*99\.9%/)).toBeVisible()
  })

  test("a withdrawn validator says so, keeps its figures and the threshold, and cannot be staked with", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorC)

    await expect(page.getByText("Validator C", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/Withdrawn, Aegis participation unconfirmed/)).toBeVisible()
    await expect(page.getByText("97.5%", { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: "At or above the 75% reward threshold" })).toBeVisible()
    await expect(page.getByText("If a validator's participation is below 75% in a reward period", { exact: false })).toBeVisible()
    await expect(detail.delegateButton).toBeDisabled()
  })

  test("shows total delegated amount", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("Total SAFE Staked")).toBeVisible({ timeout: 15_000 })
    // Total stake for mock Validator A validator is 5,000 SAFE
    await expect(page.getByText("5,000")).toBeVisible()
  })

  test("shows your delegation when connected", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("Your SAFE Staked")).toBeVisible({ timeout: 15_000 })
  })

  test("shows delegate and undelegate buttons", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(detail.delegateButton).toBeVisible({ timeout: 15_000 })
    await expect(detail.undelegateButton).toBeVisible()
  })

  test("back link navigates to validators list", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(detail.backLink).toBeVisible({ timeout: 15_000 })

    await detail.backLink.click()
    await expect(page).toHaveURL("/#/validators")
  })

  test("shows copy address button", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(detail.copyAddressButton).toBeVisible({ timeout: 15_000 })
  })

  test("shows not found for unknown validator", async ({ connectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto("0x0000000000000000000000000000000000000099")

    await expect(detail.notFoundMessage).toBeVisible({ timeout: 15_000 })
  })
})

test.describe("Validator Detail Page: selector", () => {
  test("charts participation over Beta's last days, labelled Beta, with a table and a 7-day hourly view", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.gnosisAegis = false
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorB)
    const section = page.getByRole("region", { name: "Participation over time" })

    await expect(section.getByRole("note", { name: "Beta ended" })).toBeVisible({ timeout: 15_000 })
    await expect(section.getByText(/^Beta, 21 Sep 2026 to 5 Oct 2026\. Gnosis subgraph:/)).toContainText("per complete UTC bucket")
    // 15 complete days: the first indexed day is partial and dropped.
    await expect(section.getByText("90 of 14,400 ceremonies missed", { exact: true })).toBeVisible()
    await expect(section.getByRole("img", { name: /^Beta, 21 Sep 2026 to 5 Oct 2026: 99\.37% attendance/ })).toBeVisible()
    await expect(section.locator("path.recharts-line-curve")).toHaveCount(1)

    await section.getByText("Show the figures as a table").click()
    await expect(section.getByRole("table").getByRole("row")).toHaveCount(16)

    await section.getByRole("button", { name: "7 days" }).click()
    await expect(section.getByText(/per complete UTC bucket/)).toBeVisible()
    await expect(section.getByText("42 of 6,720 ceremonies missed", { exact: true })).toBeVisible()
    await expect(section.getByRole("table").getByRole("row")).toHaveCount(169)
  })

  test("shows delegators now and over time, the registration, and the event history with explorer links", async ({ disconnectedPage: page }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)
    const delegators = page.getByRole("region", { name: "Delegators and registration" })

    await expect(delegators.getByText("26 have ever staked")).toBeVisible({ timeout: 15_000 })
    await expect(delegators.getByText("Delegators now").locator("xpath=following-sibling::dd[1]")).toHaveText("25")
    await expect(delegators.getByText("26 March 2026")).toBeVisible()
    await expect(delegators.getByRole("link", { name: /^24,741,826\s+Block on Etherscan$/ })).toHaveAttribute("href", "https://etherscan.io/block/24741826")
    await expect(delegators.getByRole("img", { name: /^Delegators: 1 on 1 Apr 2026, 25 now, at most 26\./ })).toBeVisible()

    const history = page.getByRole("region", { name: "Event history" })
    const rows = history.getByRole("row")
    await expect(rows).toHaveCount(26)
    await expect(rows.nth(1)).toContainText("Withdrawal claimed")
    await expect(rows.nth(2)).toContainText("Unstake started")
    await expect(history.getByText("25 of 29 events, newest first")).toBeVisible()
    await history.getByRole("button", { name: "Show 4 more" }).click()
    await expect(rows).toHaveCount(30)
    await expect(rows.last()).toContainText("Registered")
    await expect(rows.nth(1).getByRole("link", { name: /^0x\S+\s+Transaction on Etherscan$/ })).toHaveAttribute("href", /^https:\/\/etherscan\.io\/tx\/0x/)
  })

  test("says what is empty for a validator with no bucket and no stake", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.gnosisAegis = false
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorC)

    await expect(page.getByText("No complete participation history is available for this validator and window.")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("No address has staked with this validator.")).toBeVisible()
    const history = page.getByRole("region", { name: "Event history" })
    await expect(history.getByRole("row")).toHaveCount(2)
    await expect(history.getByRole("row").last()).toContainText("Registered")
  })

  test("says when the subgraphs have indexed nothing for the validator", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.mainnet = "empty"
    mockSubgraph.gnosis = "empty"
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("No complete participation history is available for this validator and window.")).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("The Mainnet subgraph has no record of this validator.")).toHaveCount(2)
  })

  test("says why each section is unavailable when the subgraphs fail, and keeps the rest of the page", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.mainnet = "fail"
    mockSubgraph.gnosis = "fail"
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorA)

    await expect(page.getByText("Validator A", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("Unavailable. The subgraph could not be queried.")).toHaveCount(2)
    await expect(page.getByText("Unavailable. The subgraph could not provide complete, consistent history.")).toBeVisible()
    await expect(page.getByText("Total SAFE Staked")).toBeVisible()
  })

  test("names the validator by its ENS primary name when one is set, else by SEF's label, and says which", async ({ disconnectedPage: page, mockChainState }) => {
    const detail = new ValidatorDetailPage(page)
    await detail.goto(VALIDATORS.validatorB)
    await expect(page.getByText("Names: SEF labels. No ENS primary name is set.")).toBeVisible({ timeout: 15_000 })

    mockChainState.ensNames = { [VALIDATORS.validatorA]: "validator-a.eth" }
    await detail.goto(VALIDATORS.validatorA)
    await expect(page.getByText("validator-a.eth", { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("SEF lists it as Validator A")).toBeVisible()
    await expect(page.getByText("Names: ENS primary names, verified by reverse resolution; SEF labels where no name is set.")).toBeVisible()
  })
})
