/**
 * Accessibility: axe against WCAG 2.2 A and AA on every route, without and with a wallet, and on
 * the states a visitor can land in: the restricted screen, the wrong-network notice and the
 * stake review. A serious or critical violation fails the test. Each run prints one line per
 * page, so the report can be pasted.
 */
import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"
import { VALIDATORS } from "../fixtures/test-data"

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"]
const BLOCKING = new Set(["serious", "critical"])

/** Every route, with text that shows it rendered. */
const ROUTES = [
  { path: "/", ready: "Network overview" },
  { path: "/#/dashboard", ready: "Stake your SAFE" },
  { path: "/#/validators", ready: "Safenet validators" },
  { path: `/#/validators/${VALIDATORS.validatorA}`, ready: "Back to Validators" },
  { path: "/#/withdrawals", ready: "Withdrawals" },
  { path: "/#/rewards", ready: "Rewards" },
  { path: "/#/no-such-page", ready: "Page not found" },
]

async function audit(page: Page, label: string) {
  // Animations finish first, so colour contrast is measured on the final colours.
  await page.waitForTimeout(500)
  const { violations, passes } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze()
  const blocking = violations.filter((v) => BLOCKING.has(v.impact ?? ""))
  const minor = violations.filter((v) => !BLOCKING.has(v.impact ?? ""))
  console.log(
    `axe ${label.padEnd(44)} rules passed ${String(passes.length).padStart(3)}  serious+critical ${blocking.length}  moderate+minor ${minor.length}` +
      (violations.length ? `  [${violations.map((v) => `${v.id}:${v.impact}:${v.nodes.length}`).join(", ")}]` : ""),
  )
  expect(
    blocking.map((v) => ({ rule: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target.join(" ")) })),
    `${label}: serious or critical WCAG 2.2 AA violations`,
  ).toEqual([])
}

test.describe("Accessibility, WCAG 2.2 AA", () => {
  for (const { path, ready } of ROUTES) {
    test(`${path}, no wallet`, async ({ disconnectedPage: page }) => {
      await page.goto(path)
      await expect(page.getByText(ready, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
      await audit(page, `${path} (no wallet)`)
    })

    test(`${path}, wallet connected`, async ({ connectedPage: page }) => {
      await page.goto(path)
      await expect(page.getByText(ready, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
      await audit(page, `${path} (wallet)`)
    })
  }

  test("dark theme, wallet connected", async ({ connectedPage: page }) => {
    await page.addInitScript(() => localStorage.setItem("theme", "dark"))
    for (const { path, ready } of ROUTES) {
      await page.goto(path)
      await expect(page.getByText(ready, { exact: true }).first()).toBeVisible({ timeout: 10_000 })
      await audit(page, `${path} (wallet, dark)`)
    }
  })

  test("wrong network notice", async ({ wrongNetworkPage: page }) => {
    await page.goto("/#/dashboard")
    await expect(page.getByRole("region", { name: "Wrong network" })).toBeVisible({ timeout: 10_000 })
    await audit(page, "/#/dashboard (wrong network)")
  })

  test("restricted screen", async ({ disconnectedPage: page }) => {
    await page.route("**/api.country.is**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ country: "CU" }) }),
    )
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Access Restricted" })).toBeVisible({ timeout: 10_000 })
    await audit(page, "restricted screen")
  })

  test("delegate dialog", async ({ connectedPage: page }) => {
    await page.goto(`/#/validators?delegate=${VALIDATORS.validatorA}`)
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByLabel("Amount")).toBeVisible({ timeout: 10_000 })
    await dialog.getByLabel("Amount").fill("10")
    await audit(page, "delegate dialog")

    await dialog.getByRole("button", { name: "Stake", exact: true }).click()
    await expect(dialog.getByRole("region", { name: /Before you stake/ })).toBeVisible()
    await audit(page, "delegate dialog, what happens if")
  })

  for (const theme of ["light", "dark"] as const) {
    test(`a validator below the reward threshold, ${theme} theme`, async ({ connectedPage: page }) => {
      // Its rate and its threshold marker are drawn in the warning colour, which no other mocked
      // validator shows.
      await page.route("**/mock-validators.test/**", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            { address: VALIDATORS.validatorA, is_active: true, label: "Validator A", commission: 0.05, participation_rate_14d: 0.5 },
            { address: VALIDATORS.validatorC, is_active: false, label: "Validator C", commission: 0.05, participation_rate_14d: 0.6 },
          ]),
        }),
      )
      await page.addInitScript((t) => localStorage.setItem("theme", t), theme)
      await page.goto("/#/validators")
      await expect(page.getByRole("button", { name: /Below the .* reward threshold/ }).first()).toBeVisible({ timeout: 10_000 })
      await audit(page, `/#/validators (below threshold, ${theme})`)
      await page.goto(`/#/validators/${VALIDATORS.validatorA}`)
      await expect(page.getByText("Back to Validators")).toBeVisible({ timeout: 10_000 })
      await audit(page, `validator page (below threshold, ${theme})`)
    })
  }

  test("a term's explanation, open", async ({ connectedPage: page }) => {
    await page.goto("/#/validators")
    await page.getByRole("button", { name: "Commission", exact: true }).first().click()
    await expect(page.getByRole("tooltip")).toBeVisible({ timeout: 10_000 })
    await audit(page, "/#/validators (term explanation open)")
  })
})
