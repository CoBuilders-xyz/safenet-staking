import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"

/** The restricted screen: which gate closed the interface, and the text that says why. */
function restricted(page: Page) {
  return page.getByRole("main")
}

test.describe("Restricted screen", () => {
  test("the legal pages open for a blocked visitor and make no location lookup of their own", async ({ disconnectedPage: page }) => {
    const lookups: string[] = []
    await page.route("**/api.country.is**", (route) => {
      lookups.push(route.request().url())
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "CU" }) })
    })
    await page.route("**/ipapi.co/**", (route) => {
      lookups.push(route.request().url())
      return route.abort("connectionrefused")
    })

    const legal = [
      ["/#/imprint", "Imprint"],
      ["/#/terms", "Terms of use"],
      ["/#/privacy", "Privacy policy"],
      ["/#/faq", "Frequently asked questions"],
    ] as const
    for (const [path, title] of legal) {
      await page.goto(path)
      // A full load each time: moving between hashes alone would not load the document again.
      await page.reload()
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible({ timeout: 10_000 })
      await expect(page.locator('link[rel="preconnect"]')).toHaveCount(0)
      await expect(page.getByRole("button", { name: "Connect Wallet" })).toHaveCount(0)
    }
    expect(lookups).toEqual([])

    // Into the interface from a legal page: now the check runs, and the interface stays closed.
    await page.getByRole("link", { name: "Back to Overview" }).click()
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("unavailable in Cuba")
    expect(lookups).toHaveLength(1)

    // And the restricted screen links back to the legal pages.
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click()
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible()
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toHaveCount(0)
  })

  test("the interface itself still connects early to the location service", async ({ disconnectedPage: page }) => {
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('link[rel="preconnect"]')).toHaveAttribute("href", "https://api.country.is")
  })

  test("malformed primary location and a failed fallback keep the interface closed", async ({ disconnectedPage: page }) => {
    await page.route("**/api.country.is**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: { code: "RU" } }) }),
    )
    await page.route("**/ipapi.co/**", (route) => route.abort("connectionrefused"))
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Check Failed" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Location check")
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0)
  })

  test("location check: names the country it found and offers no way around it", async ({ disconnectedPage: page }) => {
    await page.route("**/api.country.is**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "CU" }) }),
    )
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Location check")
    await expect(restricted(page)).toContainText("unavailable in Cuba")
    await expect(restricted(page)).toContainText("This interface cannot lift the restriction.")
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0)
  })

  test("location check: both lookups failing closes the interface as a failed check, and Reload retries", async ({ disconnectedPage: page }) => {
    let lookupsDown = true
    await page.route("**/api.country.is**", (route) =>
      lookupsDown
        ? route.abort("connectionrefused")
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "US" }) }),
    )
    await page.route("**/ipapi.co/**", (route) =>
      lookupsDown ? route.abort("connectionrefused") : route.fulfill({ status: 200, contentType: "text/plain", body: "US" }),
    )
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Check Failed" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Location check")
    await expect(restricted(page)).toContainText("Neither location service answered")

    lookupsDown = false
    await page.getByRole("button", { name: "Reload" }).click()
    await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible({ timeout: 10_000 })
  })

  test("sanctions screening: a 403 is a refusal", async ({ disconnectedPage: page, mockChainState }) => {
    mockChainState.sanctionsApi = "refuse"
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Sanctions screening")
    await expect(restricted(page)).toContainText("refused this connection")
  })

  test("sanctions screening: a failed request closes the interface as a failed check", async ({ disconnectedPage: page, mockChainState }) => {
    mockChainState.sanctionsApi = "fail"
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Check Failed" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Sanctions screening")
    await expect(page.getByRole("button", { name: "Reload" })).toBeVisible()
  })

  test("a refusal is named before a failed check, so the screen offers no Reload", async ({ disconnectedPage: page, mockChainState }) => {
    mockChainState.sanctionsApi = "fail"
    await page.route("**/api.country.is**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "CU" }) }),
    )
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Location check")
    await expect(page.getByRole("button", { name: "Reload" })).toHaveCount(0)
  })

  test("wallet screening: a listed wallet is refused, and disconnecting it reopens the public pages", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.walletSanctioned = true
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Wallet Restricted" })).toBeVisible({ timeout: 10_000 })
    await expect(restricted(page)).toContainText("Closed by: Wallet screening")
    await expect(restricted(page)).toContainText("The sanctions oracle on Ethereum lists this wallet address")
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0)

    await page.getByRole("button", { name: "Disconnect wallet" }).click()
    await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible({ timeout: 10_000 })
  })

  test("wallet screening: an oracle read that fails closes the interface, and Try again reads it again", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.walletSanctioned = "error"
    await page.goto("/")

    // Failed reads are retried before they count as failed, so allow for the backoff.
    await expect(page.getByRole("heading", { name: "Wallet Check Failed" })).toBeVisible({ timeout: 20_000 })
    await expect(restricted(page)).toContainText("Closed by: Wallet screening")
    await expect(restricted(page)).toContainText("could not be read for this wallet")

    mockChainState.walletSanctioned = false
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible({ timeout: 20_000 })
  })
})
