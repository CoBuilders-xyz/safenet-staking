import { test, expect } from "../fixtures/base.fixture"
import { DashboardPage } from "../pages/dashboard.page"

test.describe("My stake", () => {
  test("renders page heading", async ({ disconnectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.heading).toBeVisible()
    await expect(dashboard.subtitle).toBeVisible()
  })

  test("shows a connect prompt instead of the network figures when disconnected", async ({ disconnectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.connectPrompt).toBeVisible()
    await expect(dashboard.connectButton).toBeVisible()
    await expect(dashboard.browseValidators).toBeVisible()
    // The network-wide figures live on the Overview.
    await expect(page.getByText("Total SAFE Staked")).toHaveCount(0)
    await expect(page.getByText("Active Validators")).toHaveCount(0)
  })

  test("the connect prompt opens the wallet menu", async ({ disconnectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await dashboard.connectButton.click()
    await expect(page.getByRole("menu")).toBeVisible()
  })

  test("the connect prompt links to the validators", async ({ disconnectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await dashboard.browseValidators.click()
    await expect(page).toHaveURL("/#/validators")
  })

  test("shows user-specific stats when connected", async ({ connectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    // Wait for data to load
    await expect(page.getByText("Total SAFE Staked")).toBeVisible({ timeout: 10_000 })

    // Connected-only cards
    await expect(page.getByText("Your Staked SAFE")).toBeVisible({ timeout: 10_000 })
  })

  test("shows quick actions when connected", async ({ connectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await expect(dashboard.quickActionDelegate).toBeVisible({ timeout: 10_000 })
    await expect(dashboard.quickActionUndelegate).toBeVisible({ timeout: 10_000 })
    await expect(dashboard.quickActionClaim).toBeVisible({ timeout: 10_000 })
  })

  test("quick actions are hidden when disconnected", async ({ disconnectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    // Quick actions require connection
    await expect(page.getByRole("button", { name: /^Withdraw$/ })).not.toBeVisible()
  })

  test("delegate quick action navigates to validators", async ({ connectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await dashboard.quickActionDelegate.click()
    await expect(page).toHaveURL("/#/validators")
  })

  test("claim quick action navigates to withdrawals", async ({ connectedPage: page }) => {
    const dashboard = new DashboardPage(page)
    await dashboard.goto()

    await dashboard.quickActionClaim.click()
    await expect(page).toHaveURL("/#/withdrawals")
  })
})
