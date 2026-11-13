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

  test("footer names the operator and opens the in-app pages", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await expect(layout.footer.getByText("Operated by Backstage Online LLC")).toBeVisible()
    // playwright.config.ts sets VITE_TERMS_URL, which replaces the in-app terms.
    await expect(layout.footerTerms).toHaveAttribute("href", "https://terms.test")

    const pages = [
      { link: "Privacy", url: "/#/privacy", title: "Privacy policy" },
      { link: "Imprint", url: "/#/imprint", title: "Imprint" },
      { link: "FAQ", url: "/#/faq", title: "Frequently asked questions" },
    ]
    for (const { link, url, title } of pages) {
      await layout.footer.getByRole("link", { name: link }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible()
      await expect(page.getByText("Last updated: 13 November 2026")).toBeVisible()
    }

    // A link inside a text follows the same rule: the terms go to the URL that is set, and a
    // page with no URL set stays in the app.
    const inText = page.getByRole("main")
    await expect(inText.getByRole("link", { name: "Terms of use" }).first()).toHaveAttribute("href", "https://terms.test")
    await inText.getByRole("link", { name: "Privacy policy" }).first().click()
    await expect(page).toHaveURL("/#/privacy")
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible()

    // The skip link moves focus to the text and leaves the route alone.
    await page.getByRole("link", { name: "Skip to main content" }).focus()
    await page.keyboard.press("Enter")
    await expect(page.locator("main")).toBeFocused()
    await expect(page).toHaveURL("/#/privacy")
  })
})
