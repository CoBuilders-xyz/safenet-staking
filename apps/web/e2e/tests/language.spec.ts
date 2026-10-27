import { test, expect } from "../fixtures/base.fixture"
import { LayoutPage } from "../pages/layout.page"
import de from "../../src/i18n/locales/de.json" with { type: "json" }
import en from "../../src/i18n/locales/en.json" with { type: "json" }
import fr from "../../src/i18n/locales/fr.json" with { type: "json" }
import ru from "../../src/i18n/locales/ru.json" with { type: "json" }
import zh from "../../src/i18n/locales/zh-Hans.json" with { type: "json" }

/**
 * The language switcher on the Overview, against the mocked RPC and subgraphs. Playwright's
 * Chromium reports en-US unless a test sets `locale`, so the page starts in English.
 */
test.describe("Language", () => {
  test("switching changes the visible copy and the lang attribute, and survives a reload", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")
    await expect(page.getByRole("heading", { name: en.overview.hero.title })).toBeVisible()
    expect(await layout.lang()).toBe("en")

    await layout.languageSelect.selectOption("de")
    await expect(page.getByRole("heading", { name: de.overview.hero.title })).toBeVisible()
    await expect(page.getByRole("navigation").getByRole("link", { name: de.header.nav.overview, exact: true })).toBeVisible()
    await expect(page.getByRole("group", { name: de.overview.headline.totalStaked })).toContainText("12,345")
    await expect(page.getByRole("region", { name: de.overview.validators.title })).toContainText("140 verpasst")
    expect(await layout.lang()).toBe("de")

    await page.reload()
    await expect(page.getByRole("heading", { name: de.overview.hero.title })).toBeVisible()
    await expect(layout.languageSelect).toHaveValue("de")
    expect(await layout.lang()).toBe("de")

    await layout.languageSelect.selectOption("en")
    await expect(page.getByRole("heading", { name: en.overview.hero.title })).toBeVisible()
    expect(await layout.lang()).toBe("en")
  })

  test("Chinese renders with the system font stack and sets lang to zh-Hans", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")
    await layout.languageSelect.selectOption("zh-Hans")
    await expect(page.getByRole("heading", { name: zh.overview.hero.title })).toBeVisible()
    expect(await layout.lang()).toBe("zh-Hans")
    // No font file is fetched for Chinese: the stack in index.css ends in system-ui and sans-serif.
    const family = await page.getByRole("heading", { name: zh.overview.hero.title }).evaluate((el) => getComputedStyle(el).fontFamily)
    expect(family).toMatch(/system-ui, sans-serif$/)
  })

  for (const [code, strings] of [["en", en], ["de", de], ["ru", ru]] as const) {
    for (const width of [375, 768, 1024, 1280]) {
      test(`${code} at ${width} px: the header and the Overview fit the window`, async ({ disconnectedPage: page }) => {
        await page.setViewportSize({ width, height: 900 })
        const layout = new LayoutPage(page)
        await layout.goto("/")
        await layout.languageSelect.selectOption(code)
        await expect(page.getByRole("heading", { name: strings.overview.hero.title })).toBeVisible()
        await expect(page.getByRole("group", { name: strings.overview.headline.totalStaked })).toContainText("12,345")
        expect(await layout.overflowsHorizontally()).toBe(false)
      })
    }
  }
})

test.describe("Language on a first visit", () => {
  test.use({ locale: "fr-FR" })

  test("follows the browser's language and stores nothing until the reader chooses", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")
    await expect(page.getByRole("heading", { name: fr.overview.hero.title })).toBeVisible()
    await expect(layout.languageSelect).toHaveValue("fr")
    expect(await layout.lang()).toBe("fr")
    expect(await page.evaluate(() => localStorage.getItem("language"))).toBeNull()
  })
})
