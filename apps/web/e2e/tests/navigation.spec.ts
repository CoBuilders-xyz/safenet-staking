import { test, expect } from "../fixtures/base.fixture"
import { LayoutPage } from "../pages/layout.page"

test.describe("Navigation", () => {
  test("renders header with nav links and footer", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await expect(layout.header).toBeVisible()
    await expect(layout.footer).toBeVisible()
    await expect(layout.navDashboard).toBeVisible()
    await expect(layout.navValidators).toBeVisible()
    await expect(layout.navWithdrawals).toBeVisible()
  })

  test("dashboard link is active on home page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await expect(layout.navDashboard).toHaveAttribute("aria-current", "page")
  })

  test("navigates to validators page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await layout.navValidators.click()
    await expect(page).toHaveURL("/#/validators")

    // A retrying assertion: the URL can change a render before aria-current does.
    await expect(layout.navValidators).toHaveAttribute("aria-current", "page")
    await expect(layout.navDashboard).not.toHaveAttribute("aria-current")
  })

  test("navigates to withdrawals page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await layout.navWithdrawals.click()
    await expect(page).toHaveURL("/#/withdrawals")

    // A retrying assertion: the URL can change a render before aria-current does.
    await expect(layout.navWithdrawals).toHaveAttribute("aria-current", "page")
    await expect(layout.navDashboard).not.toHaveAttribute("aria-current")
  })

  test("logo navigates back to dashboard", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/#/validators")

    await layout.logo.click()
    await expect(page).toHaveURL("/#/")
  })

  test("footer links are present", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await expect(layout.footerTerms).toBeVisible()
    await expect(layout.footerDocs).toBeVisible()
    await expect(layout.footerFaq).toBeVisible()
  })
})
