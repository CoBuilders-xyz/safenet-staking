import AxeBuilder from "@axe-core/playwright"
import { test, expect } from "../fixtures/base.fixture"
import { VALIDATORS } from "../fixtures/test-data"
import { LayoutPage } from "../pages/layout.page"
import en from "../../src/i18n/locales/en.json" with { type: "json" }
import es from "../../src/i18n/locales/es.json" with { type: "json" }
import de from "../../src/i18n/locales/de.json" with { type: "json" }
import fr from "../../src/i18n/locales/fr.json" with { type: "json" }
import it from "../../src/i18n/locales/it.json" with { type: "json" }
import pt from "../../src/i18n/locales/pt.json" with { type: "json" }
import ru from "../../src/i18n/locales/ru.json" with { type: "json" }
import zh from "../../src/i18n/locales/zh-Hans.json" with { type: "json" }

for (const [code, copy] of [["en", en], ["es", es], ["de", de], ["fr", fr], ["it", it], ["pt", pt], ["ru", ru], ["zh-Hans", zh]] as const) {
  test(`${code}: selector and charts fit a phone and work from the keyboard`, async ({ disconnectedPage: page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("/#/validators")
    const layout = new LayoutPage(page)
    await layout.languageSelect.selectOption(code)
    const sort = page.getByRole("group", { name: copy.selector.sortBy })
    const delegators = sort.getByRole("button", { name: copy.selector.delegators, exact: true })
    await delegators.focus()
    await page.keyboard.press("Enter")
    await expect(delegators).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText(copy.selector.namesNone)).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
    await page.getByRole("link", { name: "Validator B", exact: true }).click()
    const section = page.getByRole("region", { name: copy.selector.participationTitle, exact: true })
    await expect(section.getByRole("img")).toBeVisible()
    const seven = section.getByRole("button", { name: copy.selector.sevenDays })
    await seven.focus()
    await page.keyboard.press("Space")
    await expect(seven).toHaveAttribute("aria-pressed", "true")
    const tableToggle = section.locator("summary")
    await tableToggle.focus()
    await page.keyboard.press("Enter")
    await expect(section.getByRole("table")).toBeVisible()
    await page.keyboard.press("Tab")
    await expect(section.getByRole("region")).toBeFocused()
    expect(await layout.overflowsHorizontally()).toBe(false)
    await page.screenshot({ path: testInfo.outputPath(`selector-${code}-mobile.png`), fullPage: true })
    const events = page.getByRole("region", { name: copy.selector.eventsNewest, exact: true })
    await events.focus()
    await page.keyboard.press("ArrowRight")
    await expect.poll(() => events.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    if (code === "en" || code === "ru") {
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
      expect(result.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([])
    }
  })
}

test("Aegis membership retains a validator with zero attendance", async ({ disconnectedPage: page, mockSubgraph }) => {
  mockSubgraph.gnosisZeroAttendance = true
  await page.goto(`/#/validators/${VALIDATORS.validatorB}`)
  const section = page.getByRole("region", { name: "Participation over time" })
  await expect(section.getByText("0.00%", { exact: true }).first()).toBeVisible()
  await expect(section.getByText(/^Aegis, 8 Oct 2026 to.*Gnosis subgraph/)).toBeVisible()
  await expect(section.getByRole("note", { name: "Beta ended" })).toHaveCount(0)
})
