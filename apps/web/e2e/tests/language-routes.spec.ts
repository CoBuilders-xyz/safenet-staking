import { test, expect } from "../fixtures/base.fixture"
import { REWARD_PROOFS, VALIDATORS } from "../fixtures/test-data"
import { LayoutPage } from "../pages/layout.page"
import es from "../../src/i18n/locales/es.json" with { type: "json" }
import de from "../../src/i18n/locales/de.json" with { type: "json" }
import fr from "../../src/i18n/locales/fr.json" with { type: "json" }
import it from "../../src/i18n/locales/it.json" with { type: "json" }
import pt from "../../src/i18n/locales/pt.json" with { type: "json" }
import ru from "../../src/i18n/locales/ru.json" with { type: "json" }
import zh from "../../src/i18n/locales/zh-Hans.json" with { type: "json" }

const languages = [["es", es], ["de", de], ["fr", fr], ["it", it], ["pt", pt], ["ru", ru], ["zh-Hans", zh]] as const

for (const [code, copy] of languages) {
  test(`${code}: every route and disconnected state follows the selected language`, async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await page.goto("/#/dashboard")
    await layout.languageSelect.selectOption(code)
    await expect(page.getByRole("heading", { name: copy.dashboard.stakeYourSafe, exact: true })).toBeVisible()
    await expect(layout.header.getByRole("button", { name: copy.wallet.connectWallet, exact: true })).toBeVisible()
    await expect(page.getByText(copy.dashboard.connectToSeeYourStakes, { exact: true })).toBeVisible()
    await expect(page.getByRole("navigation").getByRole("link", { name: copy.header.nav.dashboard, exact: true })).toHaveAttribute("aria-current", "page")
    await expect(page.getByText(copy.onboarding.hero.dashboard.replace(/<[^>]+>/g, ""), { exact: true })).toBeVisible()

    await page.goto("/#/validators")
    await expect(page.getByRole("heading", { name: copy.validators.safenetValidators, exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: copy.onboarding.commission, exact: true }).first()).toBeVisible()
    await page.getByRole("link", { name: "Validator A", exact: true }).click()
    await expect(page.getByRole("link", { name: copy.validators.backToValidators })).toBeVisible()
    await expect(page.getByText(copy.validators.totalSafeStaked, { exact: true })).toBeVisible()

    await page.goto("/#/withdrawals")
    await expect(page.getByRole("heading", { name: copy.withdrawals.withdrawals, exact: true })).toBeVisible()
    await expect(page.getByText(copy.withdrawals.connectYourWalletToViewWithdrawalQueue, { exact: true })).toBeVisible()

    await page.goto("/#/rewards")
    await expect(page.getByRole("heading", { name: copy.rewards.rewards, exact: true })).toBeVisible()
    await expect(page.getByText(copy.rewards.connectAWalletToClaim, { exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: copy.rewards.claimStake, exact: true })).toBeDisabled()
    await expect(page.getByRole("region", { name: copy.rewards.verifiability })).toBeVisible()
    // Russian/Chinese headings must not produce duplicate ids through an ASCII slug.
    const ids = await page.getByRole("region").evaluateAll(nodes => nodes.map(node => node.getAttribute("aria-labelledby")))
    expect(new Set(ids).size).toBe(ids.length)

    await page.reload()
    await expect(layout.languageSelect).toHaveValue(code)
    await expect(page.getByText(copy.rewards.connectAWalletToClaim, { exact: true })).toBeVisible()
  })

  test(`${code}: claim, approve and stake advance through translated steps`, async ({ connectedPage: page, mockChainState }) => {
    await page.setViewportSize({ width: code === "es" || code === "ru" ? 390 : 1280, height: 720 })
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    mockChainState.allowance = 0n
    const before = mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase()) ?? 0n
    await page.goto("/#/rewards")
    await new LayoutPage(page).languageSelect.selectOption(code)
    const actions = page.getByRole("region", { name: copy.rewards.actions, exact: true })
    await actions.getByRole("button", { name: copy.rewards.claimStake, exact: true }).click()
    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: copy.rewards.claimStake })).toBeVisible()
    await dialog.getByRole("button", { name: copy.rewards.claimSafe.replace("{{amount}}", "100"), exact: true }).click()
    await expect(dialog.getByLabel(copy.staking.amount, { exact: true })).toHaveValue("100")
    await expect(dialog.getByRole("listitem").filter({ hasText: copy.validators.stake })).toHaveAttribute("aria-current", "step")
    await dialog.getByLabel(copy.dashboard.validator, { exact: true }).selectOption({ label: copy.validators.commission2.replace("{{label}}", "Validator A").replace("{{commission}}", "5") })
    await dialog.getByLabel(copy.staking.amount, { exact: true }).fill("60")
    await expect(dialog.getByText(copy.rewards.safeStaysInYourWalletNotStaked.replace("{{amount}}", "40"))).toBeVisible()
    await dialog.getByRole("button", { name: copy.staking.approveExactAmount, exact: true }).click()
    const stake = dialog.getByRole("button", { name: copy.validators.stake, exact: true })
    await expect(stake).toBeEnabled()
    expect(mockChainState.allowance).toBe(60n * 10n ** 18n)
    await stake.click()
    await expect(dialog.getByRole("heading", { name: copy.onboarding.beforeStake.replace("{{amount}}", "60").replace("{{validator}}", "Validator A"), exact: true })).toBeVisible()
    expect(mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase()) ?? 0n).toBe(before)
    await dialog.getByRole("button", { name: copy.onboarding.back, exact: true }).click()
    await expect(dialog.getByLabel(copy.staking.amount, { exact: true })).toHaveValue("60")
    await stake.click()
    await dialog.getByRole("button", { name: copy.onboarding.confirmStake, exact: true }).click()
    await expect(dialog.getByRole("status")).toContainText(copy.rewards.stakedWith.replace("{{amount}}", "60").replace("{{validator}}", "Validator A"))
    expect((mockChainState.stakes.get(VALIDATORS.validatorA.toLowerCase()) ?? 0n) - before).toBe(60n * 10n ** 18n)
  })
}

for (const [code, copy] of languages.filter(([code]) => ["es", "de", "ru", "zh-Hans"].includes(code))) {
  test(`${code}: connected mobile routes fit and withdrawals use translated actions`, async ({ connectedPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    const layout = new LayoutPage(page)
    await page.goto("/#/dashboard")
    await layout.languageSelect.selectOption(code)
    await expect(page.getByRole("heading", { name: copy.dashboard.stakeYourSafe })).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
    await page.goto("/#/validators")
    await expect(page.getByRole("link", { name: "Validator A", exact: true })).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
    await page.goto("/#/withdrawals")
    await expect(page.getByText(copy.withdrawals.readyToWithdraw)).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
    await page.getByRole("button", { name: copy.rewards.claim2, exact: true }).click()
    await expect(page.getByText(copy.withdrawals.noPendingWithdrawals, { exact: true })).toBeVisible()
    await page.goto("/#/rewards")
    await expect(page.getByRole("region", { name: copy.rewards.actions })).toBeVisible()
    expect(await layout.overflowsHorizontally()).toBe(false)
  })
}
