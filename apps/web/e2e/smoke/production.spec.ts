import { test, expect, type Page } from "@playwright/test"

/**
 * The production deployment at PRODUCTION_URL, as a visitor without a wallet sees it. No mocks:
 * every figure comes from the RPC, the subgraphs and SEF's files the deployment reads. Each test
 * waits for a section to leave its loading state, then asserts what it shows, so a figure the
 * interface could not read fails the test instead of passing as a skeleton.
 *
 * Paths are relative, `./#/…`, so a deployment served from a path keeps it.
 */

/** Opens a route of the hash router. */
async function open(page: Page, route: string): Promise<void> {
  const response = await page.goto(`./#/${route}`)
  expect(response?.status(), "the deployment answers the index").toBe(200)
}

test("the index answers and carries the title", async ({ page }) => {
  await open(page, "")
  await expect(page).toHaveTitle("Safenet Staking")
})

test("the overview shows a total staked figure", async ({ page }) => {
  await open(page, "")
  const total = page.getByRole("group", { name: "Total SAFE staked" })
  await expect(total).toBeVisible()
  await expect(total.getByLabel("Loading Total SAFE staked")).toHaveCount(0)
  await expect(total).not.toContainText("Unavailable")
  await expect(total).toContainText(/\d/)
})

test("the validators list shows at least one validator", async ({ page }) => {
  await open(page, "validators")
  await expect(page.getByRole("heading", { name: "Safenet validators", level: 1 })).toBeVisible()
  // Each validator links to its own page, whatever its card shows.
  await expect(page.locator('a[href*="#/validators/0x"]').first()).toBeVisible()
})

test("the rewards page renders the programme without a load error", async ({ page }) => {
  await open(page, "rewards")
  const programme = page.getByRole("region", { name: "Programme" })
  await expect(programme).toBeVisible()
  // The section shows either the figures or SEF's file error: wait for one, then require the first.
  const loaded = programme.getByText("Allocated to date", { exact: true })
  const failed = programme.getByText(/could not be loaded/)
  await expect(loaded.or(failed).first()).toBeVisible()
  expect(await failed.count(), "the Programme section reports a load error").toBe(0)
  await expect(loaded).toBeVisible()
})

test("manifest.json carries what Safe{Wallet} reads, and its icon exists", async ({ request, baseURL }) => {
  const response = await request.get("manifest.json")
  expect(response.status(), "manifest.json answers").toBe(200)
  // Safe{Wallet} reads the manifest from its own origin. This request has no CORS, so without this
  // header check a manifest Safe{Wallet} cannot read would still pass.
  expect(response.headers()["access-control-allow-origin"], "manifest.json is readable from another origin").toBe("*")
  const manifest = (await response.json()) as Record<string, unknown>
  for (const field of ["name", "description", "iconPath"]) {
    expect(typeof manifest[field], `manifest.json carries ${field}`).toBe("string")
    expect((manifest[field] as string).length, `${field} is not empty`).toBeGreaterThan(0)
  }
  const icon = await request.get(new URL(manifest.iconPath as string, baseURL).href)
  expect(icon.status(), "the iconPath answers").toBe(200)
  expect(icon.headers()["content-type"], "the iconPath is an image").toMatch(/^image\//)
})
