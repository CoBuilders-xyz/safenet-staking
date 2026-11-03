import type { Page, Locator } from "@playwright/test"

export class DashboardPage {
  readonly page: Page
  readonly heading: Locator
  readonly subtitle: Locator
  readonly statsCards: Locator
  readonly totalDelegatedCard: Locator
  readonly yourDelegatedCard: Locator
  readonly activeValidatorsCard: Locator
  readonly quickActionDelegate: Locator
  readonly quickActionUndelegate: Locator
  readonly quickActionClaim: Locator
  readonly onboardingBanner: Locator
  readonly connectPrompt: Locator
  readonly connectButton: Locator
  readonly browseValidators: Locator
  readonly onboardingDismissButton: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole("heading", { name: "Stake your SAFE" })
    this.subtitle = page.getByText("Earn rewards for helping secure Safenet")
    this.statsCards = page.locator("[class*='grid'] > div").filter({ has: page.locator("[class*='CardTitle']") })
    this.totalDelegatedCard = page.getByText("Total SAFE Staked").locator("../..")
    this.yourDelegatedCard = page.getByText("Your Staked SAFE").locator("../..")
    this.activeValidatorsCard = page.getByText("Active Validators").locator("../..")
    this.quickActionDelegate = page.getByRole("button", { name: /^Stake$/ }).first()
    this.quickActionUndelegate = page.getByRole("button", { name: /^Unstake$/ }).first()
    this.quickActionClaim = page.getByRole("button", { name: /^Withdraw$/ }).first()
    this.onboardingBanner = page.getByText("Welcome to Safe Staking")
    this.connectPrompt = page.getByText("Connect your wallet to see your stakes, rewards, and positions", { exact: true })
    this.connectButton = page.getByRole("main").getByRole("button", { name: "Connect Wallet", exact: true })
    this.browseValidators = page.getByRole("main").getByRole("link", { name: "Browse validators", exact: true })
    this.onboardingDismissButton = page.getByRole("button", { name: "Dismiss" })
  }

  async goto() {
    await this.page.goto("/#/dashboard")
  }
}
