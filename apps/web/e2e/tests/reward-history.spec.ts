import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"
import { DEPLOY_BLOCK, TEST_USER } from "../fixtures/test-data"
import { LayoutPage } from "../pages/layout.page"
import en from "../../src/i18n/locales/en.json" with { type: "json" }
import es from "../../src/i18n/locales/es.json" with { type: "json" }
import de from "../../src/i18n/locales/de.json" with { type: "json" }
import fr from "../../src/i18n/locales/fr.json" with { type: "json" }
import it from "../../src/i18n/locales/it.json" with { type: "json" }
import pt from "../../src/i18n/locales/pt.json" with { type: "json" }
import ru from "../../src/i18n/locales/ru.json" with { type: "json" }
import zh from "../../src/i18n/locales/zh-Hans.json" with { type: "json" }

async function history(page: Page, root: string, mode: "ok" | "full" | "fail" = "ok") {
  await page.route("**/mock-subgraph.test/mainnet", async (route) => {
    const { operationName, variables } = route.request().postDataJSON()
    if (!String(operationName).startsWith("RewardHistory")) return route.fallback()
    if (mode === "fail") return route.fulfill({ status: 503, body: "unavailable" })
    const block = Number(DEPLOY_BLOCK) + 300
    const timestamp = Math.floor(Date.now() / 1000) - 30
    const _meta = { block: { number: block, timestamp }, hasIndexingErrors: false }
    let data
    if (operationName === "RewardHistoryPeriods") {
      expect(variables.limit).toBe(12)
      data = { _meta, network: { rewardPeriods: 2 }, rewardPeriods: [2, 1].map((period) => ({
        period, root, blockNumber: String(Number(DEPLOY_BLOCK) + period * 100),
        timestamp: String(timestamp - 300 + period * 100), transactionHash: root,
      })) }
    } else {
      expect(variables).toEqual({
        account: TEST_USER.toLowerCase(), from: String(Number(DEPLOY_BLOCK) + 100),
        block: { number: block }, limit: 1000,
      })
      // Live graph-node omits the timestamp for a query pinned by block number.
      data = { _meta: { ..._meta, block: { ..._meta.block, timestamp: null } }, rewardClaims: mode === "full" ? Array.from({ length: 1000 }, (_, i) => ({
        id: String(i), account: TEST_USER, blockNumber: String(block), amount: "1", cumulativeAmount: String(i + 1),
      })) : [] }
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) })
  })
}

for (const [code, copy] of [["en", en], ["es", es], ["de", de], ["fr", fr], ["it", it], ["pt", pt], ["ru", ru], ["zh-Hans", zh]] as const) {
  test(`${code}: verified history fits a phone and its table supports keyboard scrolling`, async ({ connectedPage: page, mockChainState }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await history(page, mockChainState.merkleRoot)
    await page.goto("/#/rewards")
    const layout = new LayoutPage(page)
    await layout.languageSelect.selectOption(code)
    const table = page.getByRole("table", { name: copy.rewardHistory.title })
    await expect(table).toBeVisible()
    await expect(table.getByRole("row")).toHaveCount(3)
    await expect(table.getByRole("cell", { name: "0", exact: true })).toHaveCount(4)
    await expect(page.getByText(copy.rewardHistory.meaning)).toBeVisible()
    await expect(page.getByText(copy.rewardHistory.order)).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
    const scroll = table.locator("..")
    await scroll.focus()
    await expect(scroll).toBeFocused()
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => scroll.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    if (code === "en" || code === "ru") {
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
      expect(audit.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([])
    }
  })
}

test("a full claim page shows incomplete history; retry can recover without affecting the other sections", async ({ connectedPage: page, mockChainState }) => {
  await history(page, mockChainState.merkleRoot, "full")
  await page.goto("/#/rewards")
  const section = page.getByRole("region", { name: en.rewardHistory.title, exact: true })
  await expect(section.getByRole("alert")).toHaveText(/History is incomplete/)
  await expect(section.getByRole("table")).toHaveCount(0)
  await expect(page.getByRole("region", { name: "Actions", exact: true })).toBeVisible()
  await history(page, mockChainState.merkleRoot)
  await section.getByRole("button", { name: "Retry" }).click()
  await expect(section.getByRole("table")).toBeVisible()
})

test("a failed subgraph shows unavailable history without zeros", async ({ connectedPage: page, mockChainState }) => {
  await history(page, mockChainState.merkleRoot, "fail")
  await page.goto("/#/rewards")
  const section = page.getByRole("region", { name: en.rewardHistory.title, exact: true })
  await expect(section.getByRole("alert")).toHaveText(/History is unavailable/)
  await expect(section.getByRole("table")).toHaveCount(0)
})

test("disconnected history sends no account query", async ({ disconnectedPage: page }) => {
  let calls = 0
  page.on("request", (request) => { if (request.postData()?.includes("RewardHistory")) calls++ })
  await page.goto("/#/rewards")
  await expect(page.getByText(en.rewardHistory.connect)).toBeVisible()
  expect(calls).toBe(0)
})
