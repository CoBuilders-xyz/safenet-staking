import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"
import { TEST_USER, VALIDATORS, WRONG_CHAIN_ID_HEX } from "../fixtures/test-data"

/** Every screen that reads the chain, with text that shows it rendered. */
const SCREENS = [
  { path: "/", ready: "Network overview" },
  { path: "/#/dashboard", ready: "Stake your SAFE" },
  { path: "/#/validators", ready: "Safenet validators" },
  { path: `/#/validators/${VALIDATORS.validatorA}`, ready: "Back to Validators" },
  { path: "/#/withdrawals", ready: "Manage your pending withdrawals and withdraw undelegated tokens" },
  { path: "/#/rewards", ready: "Claim your Safenet rewards and check them against the chain" },
]

function notice(page: Page) {
  return page.getByRole("region", { name: "Wrong network" })
}

test.describe("Wrong network", () => {
  for (const { path, ready } of SCREENS) {
    test(`${path} says the wallet is on another network and offers the switch`, async ({ wrongNetworkPage: page }) => {
      await page.goto(path)

      await expect(page.getByText(ready, { exact: true })).toBeVisible({ timeout: 10_000 })
      await expect(notice(page)).toBeVisible()
      await expect(notice(page)).toContainText(`chain ID ${parseInt(WRONG_CHAIN_ID_HEX, 16)}`)
      await expect(notice(page)).toContainText("staking, unstaking and claiming are off")
      await expect(notice(page).getByRole("button", { name: "Switch to Ethereum" })).toBeVisible()
    })
  }

  test("the figures stay those of Ethereum, and only the actions stop", async ({ wrongNetworkPage: page }) => {
    await page.goto("/#/withdrawals")

    await expect(notice(page)).toBeVisible({ timeout: 10_000 })
    // The queue is read from Ethereum, not through the wallet, so it still shows.
    await expect(page.getByRole("heading", { name: "Pending Withdrawals" })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("button", { name: "Claim", exact: true })).toHaveCount(0)
  })

  test("switching from the notice restores the actions", async ({ wrongNetworkPage: page }) => {
    await page.goto("/#/withdrawals")

    await notice(page).getByRole("button", { name: "Switch to Ethereum" }).click()

    await expect(notice(page)).toHaveCount(0, { timeout: 10_000 })
    const truncated = TEST_USER.slice(0, 6) + "..." + TEST_USER.slice(-4)
    await expect(page.getByText(truncated)).toBeVisible()
    await expect(page.getByRole("button", { name: "Claim", exact: true })).toBeVisible({ timeout: 10_000 })
  })

  test("a wallet on Ethereum sees no notice", async ({ connectedPage: page }) => {
    await page.goto("/#/withdrawals")

    await expect(page.getByRole("heading", { name: "Pending Withdrawals" })).toBeVisible({ timeout: 10_000 })
    await expect(notice(page)).toHaveCount(0)
  })
})
