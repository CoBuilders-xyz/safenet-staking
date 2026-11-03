import { test, expect } from "../fixtures/base.fixture"
import { LayoutPage } from "../pages/layout.page"

test.describe("Navigation", () => {
  test("renders header with nav links and footer", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await expect(layout.header).toBeVisible()
    await expect(layout.footer).toBeVisible()
    await expect(layout.navOverview).toBeVisible()
    await expect(layout.navMyStake).toBeVisible()
    await expect(layout.navValidators).toBeVisible()
    await expect(layout.navWithdrawals).toBeVisible()
  })

  test("overview comes first in the navigation and is active on the home page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await expect(layout.navOverview).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("navigation").getByRole("link").first()).toHaveText("Overview")
  })

  test("navigates to My stake", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await layout.navMyStake.click()
    await expect(page).toHaveURL("/#/dashboard")
    await expect(layout.navMyStake).toHaveAttribute("aria-current", "page")
    await expect(page.getByRole("heading", { name: "Stake your SAFE" })).toBeVisible()
  })

  test("navigates to validators page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await layout.navValidators.click()
    await expect(page).toHaveURL("/#/validators")

    // A retrying assertion: the URL can change a render before aria-current does.
    await expect(layout.navValidators).toHaveAttribute("aria-current", "page")
    await expect(layout.navOverview).not.toHaveAttribute("aria-current")
  })

  test("navigates to withdrawals page", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")

    await layout.navWithdrawals.click()
    await expect(page).toHaveURL("/#/withdrawals")

    // A retrying assertion: the URL can change a render before aria-current does.
    await expect(layout.navWithdrawals).toHaveAttribute("aria-current", "page")
    await expect(layout.navOverview).not.toHaveAttribute("aria-current")
  })

  test("logo navigates back to the overview", async ({ disconnectedPage: page }) => {
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
