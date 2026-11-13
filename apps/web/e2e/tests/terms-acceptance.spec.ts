import { test, expect } from "../fixtures/base.fixture"
import { LayoutPage } from "../pages/layout.page"
import { TEST_USER } from "../fixtures/test-data"
import { TERMS_ACCEPTANCE_STORAGE_KEY, TERMS_VERSION } from "../../src/config/terms"

/**
 * A visitor accepts the Terms of use and the Privacy policy before a wallet connects. Every other
 * spec starts with them accepted; here the browser starts without.
 */
test.use({ termsAccepted: false })

const stored = (page: import("@playwright/test").Page) =>
  page.evaluate((key) => localStorage.getItem(key), TERMS_ACCEPTANCE_STORAGE_KEY)

test.describe("Terms acceptance before a wallet connects", () => {
  test("asks first, links both texts, and connects nothing when the visitor cancels", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await layout.connectButton.click()
    const dialog = page.getByRole("dialog", { name: "Before you connect" })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText("By connecting, you agree to the Terms of use and the Privacy policy.")
    // playwright.config.ts sets VITE_TERMS_URL, which replaces the in-app terms in every link.
    await expect(dialog.getByRole("link", { name: "Terms of use" })).toHaveAttribute("href", "https://terms.test")
    await expect(dialog.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "#/privacy")
    await expect(dialog.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("target", "_blank")
    await expect(page.getByRole("menu")).toHaveCount(0)

    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole("menu")).toHaveCount(0)
    expect(await stored(page)).toBeNull()
  })

  test("records the accepted version, goes on to the wallet menu, and does not ask again", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()

    await layout.connectButton.click()
    await page.getByRole("button", { name: "Agree and connect" }).click()
    await expect(page.getByRole("menu")).toBeVisible()
    await expect(page.getByRole("menuitem", { name: "WalletConnect" })).toBeVisible()
    expect(JSON.parse((await stored(page))!).version).toBe(TERMS_VERSION)

    await page.reload()
    await layout.connectButton.click()
    await expect(page.getByRole("menu")).toBeVisible()
    await expect(page.getByRole("dialog")).toHaveCount(0)
  })

  test("asks again when the accepted version is an older one", async ({ disconnectedPage: page }) => {
    await page.addInitScript(
      (key) => localStorage.setItem(key, JSON.stringify({ version: "2000-01-01", acceptedAt: "2000-01-01T00:00:00.000Z" })),
      TERMS_ACCEPTANCE_STORAGE_KEY,
    )
    const layout = new LayoutPage(page)
    await layout.goto()

    await layout.connectButton.click()
    await expect(page.getByRole("dialog", { name: "Before you connect" })).toBeVisible()
  })

  test("restores no earlier wallet session until the visitor accepts", async ({ connectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto()
    const truncated = TEST_USER.slice(0, 6) + "..." + TEST_USER.slice(-4)

    // The wallet has a session from before, but the terms are not accepted: no reconnect.
    await expect(layout.connectButton).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(truncated)).toHaveCount(0)

    await layout.connectButton.click()
    await page.getByRole("button", { name: "Agree and connect" }).click()
    await page.getByRole("menuitem", { name: "Browser Wallet" }).click()
    await expect(page.locator("header").getByText(truncated)).toBeVisible({ timeout: 10_000 })
  })
})
