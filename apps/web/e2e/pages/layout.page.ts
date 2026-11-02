import type { Page, Locator } from "@playwright/test"

export class LayoutPage {
  readonly page: Page
  readonly header: Locator
  readonly footer: Locator
  readonly navOverview: Locator
  readonly navMyStake: Locator
  readonly navValidators: Locator
  readonly navWithdrawals: Locator
  readonly navRewards: Locator
  readonly themeToggle: Locator
  readonly connectButton: Locator
  readonly disconnectButton: Locator
  readonly logo: Locator
  readonly footerTerms: Locator
  readonly footerDocs: Locator
  readonly footerFaq: Locator
  /** Found by role alone: its name is "Language" in English and changes with the language. */
  readonly languageSelect: Locator

  constructor(page: Page) {
    this.page = page
    this.header = page.locator("header")
    this.footer = page.locator("footer")
    this.navOverview = page.getByRole("navigation").getByRole("link", { name: "Overview", exact: true })
    this.navMyStake = page.getByRole("navigation").getByRole("link", { name: "My stake", exact: true })
    this.navValidators = page.getByRole("link", { name: "Validators" })
    this.navWithdrawals = page.getByRole("link", { name: "Withdrawals" })
    this.navRewards = page.getByRole("link", { name: "Rewards", exact: true })
    this.themeToggle = page.getByRole("button", { name: /Switch to (light|dark) mode/ })
    this.connectButton = page.getByRole("button", { name: "Connect Wallet" })
    this.disconnectButton = page.getByRole("button", { name: "Disconnect" })
    this.logo = page.locator("header").getByRole("link").first()
    this.footerTerms = page.getByRole("link", { name: "Terms" })
    this.footerDocs = page.getByRole("link", { name: "Documentation" })
    this.footerFaq = page.getByRole("link", { name: "FAQ" })
    this.languageSelect = page.locator("header").getByRole("combobox")
  }

  async goto(path = "/") {
    await this.page.goto(path)
  }

  async lang(): Promise<string> {
    return this.page.locator("html").getAttribute("lang").then((l) => l ?? "")
  }

  /** True when the page is wider than the window: a string too long for its box pushes it out. */
  async overflowsHorizontally(): Promise<boolean> {
    return this.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
  }

  async isDarkMode(): Promise<boolean> {
    return this.page.locator("html").evaluate((el) => el.classList.contains("dark"))
  }
}
