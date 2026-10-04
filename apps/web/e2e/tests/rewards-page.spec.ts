import { test, expect } from "../fixtures/base.fixture"
import { LayoutPage } from "../pages/layout.page"
import { MERKLE_DROP_CONTRACT, OTHER_MERKLE_ROOT, REWARD_PROOFS, TEST_MERKLE_ROOT } from "../fixtures/test-data"
import type { Locator, Page } from "@playwright/test"

// Default mock state: SEF's file allocates 1,000 SAFE under TEST_MERKLE_ROOT, the MerkleDrop
// reports the same root and holds 400 SAFE, so 600 are claimed network-wide (60%, 40% unclaimed).

function section(page: Page, name: string): Locator {
  return page.getByRole("region", { name })
}

/** The value printed next to a label inside a section. */
function valueOf(region: Locator, label: string): Locator {
  return region.getByText(label, { exact: true }).locator("xpath=following-sibling::dd[1]")
}

function claimButton(page: Page): Locator {
  return section(page, "Actions").getByRole("button", { name: "Claim", exact: true })
}

test.describe("Rewards page", () => {
  test("is reachable from the header and marked active", async ({ disconnectedPage: page }) => {
    const layout = new LayoutPage(page)
    await layout.goto("/")
    await layout.navRewards.click()

    await expect(page).toHaveURL(/#\/rewards$/)
    expect(await layout.getActiveNavItem()).toBe("Rewards")
  })

  test("disconnected: explains, prompts to connect, and still shows the programme", async ({ disconnectedPage: page }) => {
    await page.goto("/#/rewards")

    const yours = section(page, "Your rewards")
    await expect(yours.getByText(/Connect a wallet to see what it earned/)).toBeVisible()
    await expect(yours.getByRole("button", { name: "Connect Wallet" })).toBeVisible()

    await expect(claimButton(page)).toBeDisabled()
    await expect(section(page, "Actions").getByText("Connect a wallet to claim.")).toBeVisible()
    await expect(section(page, "Actions").getByRole("button", { name: "Claim & Stake" })).toBeDisabled()

    const programme = section(page, "Programme")
    await expect(valueOf(programme, "Allocated to date")).toHaveText("1,000 SAFE", { timeout: 10_000 })
    await expect(valueOf(programme, "Claimed network-wide")).toHaveText("600 SAFE")
    await expect(valueOf(programme, "Unclaimed share")).toHaveText("40.00%")
    await expect(valueOf(programme, "Last computed period ended")).toContainText("Tue 22 Sep 2026, 00:00 UTC")
    await expect(valueOf(programme, "Epoch")).toHaveText("7")
  })

  test("connected with claimable rewards: shows the amounts and a working Claim", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")

    const yours = section(page, "Your rewards")
    await expect(valueOf(yours, "Available to claim")).toHaveText("100 SAFE", { timeout: 10_000 })
    await expect(valueOf(yours, "Cumulative earned")).toHaveText("100 SAFE")
    await expect(valueOf(yours, "Already claimed")).toHaveText("0 SAFE")
    await expect(claimButton(page)).toBeEnabled()
  })

  test("claim success: pays out, and both your and the programme figures update", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")

    await expect(claimButton(page)).toBeEnabled({ timeout: 10_000 })
    await claimButton(page).click()

    const dialogClaim = page.getByRole("dialog").getByRole("button", { name: "Claim Rewards" })
    await expect(dialogClaim).toBeEnabled()
    await dialogClaim.click()

    await expect(page.getByText("Rewards claimed")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole("dialog")).not.toBeVisible()

    const yours = section(page, "Your rewards")
    await expect(valueOf(yours, "Available to claim")).toHaveText("0 SAFE", { timeout: 10_000 })
    await expect(valueOf(yours, "Already claimed")).toHaveText("100 SAFE")
    await expect(claimButton(page)).toBeDisabled()
    await expect(section(page, "Actions").getByText("Nothing to claim right now.")).toBeVisible()

    // The 100 SAFE left the MerkleDrop: 400 -> 300 held, 600 -> 700 claimed network-wide.
    await expect(valueOf(section(page, "Programme"), "Claimed network-wide")).toHaveText("700 SAFE", { timeout: 20_000 })
    await expect(section(page, "Verifiability").getByText("300 SAFE")).toBeVisible()
  })

  test("verifiability: names the contract and confirms the roots match", async ({ disconnectedPage: page }) => {
    await page.goto("/#/rewards")

    const verify = section(page, "Verifiability")
    await expect(verify.getByText(MERKLE_DROP_CONTRACT, { exact: true })).toBeVisible()
    await expect(verify.getByRole("link", { name: /View on/ })).toHaveAttribute(
      "href",
      new RegExp(`/address/${MERKLE_DROP_CONTRACT}$`, "i"),
    )
    await expect(verify.getByText(TEST_MERKLE_ROOT, { exact: true })).toHaveCount(2, { timeout: 10_000 })
    await expect(verify.getByText("Match", { exact: true })).toBeVisible()
    await expect(verify.getByText("400 SAFE")).toBeVisible()
  })

  test("root mismatch: flags it and blocks the claim", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.merkleRoot = OTHER_MERKLE_ROOT
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")

    const verify = section(page, "Verifiability")
    await expect(verify.getByText("Differs", { exact: true })).toBeVisible({ timeout: 10_000 })
    await expect(verify.getByText(OTHER_MERKLE_ROOT, { exact: true })).toBeVisible()
    await expect(verify.getByText(TEST_MERKLE_ROOT, { exact: true })).toBeVisible()

    await expect(section(page, "Actions").getByText(/Claiming opens when they match/)).toBeVisible()
    await expect(claimButton(page)).toBeDisabled()
  })

  test("never earned: says so instead of showing zeros", async ({ connectedPage: page }) => {
    // Default mockChainState.rewardProof is undefined -> the proof endpoint answers 404
    await page.goto("/#/rewards")

    await expect(section(page, "Your rewards").getByText(/has not earned rewards in Safenet Beta/)).toBeVisible({ timeout: 10_000 })
    await expect(section(page, "Actions").getByText("This address has nothing to claim.")).toBeVisible()
    await expect(claimButton(page)).toBeDisabled()
  })

  test("fully claimed: nothing to claim", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.fullyClaimed
    mockChainState.merkleDropClaimed = BigInt(REWARD_PROOFS.fullyClaimed.cumulativeAmount)

    await page.goto("/#/rewards")

    await expect(valueOf(section(page, "Your rewards"), "Available to claim")).toHaveText("0 SAFE", { timeout: 10_000 })
    await expect(valueOf(section(page, "Your rewards"), "Already claimed")).toHaveText("50 SAFE")
    await expect(claimButton(page)).toBeDisabled()
  })

  test("held pending compliance: shows the amount with a neutral note", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.partialKyc

    await page.goto("/#/rewards")

    const yours = section(page, "Your rewards")
    await expect(valueOf(yours, "Held pending compliance")).toHaveText("50 SAFE", { timeout: 10_000 })
    await expect(yours.getByText(/until its compliance checks/)).toBeVisible()
  })

  test("wrong network: blocks the claim and says why", async ({ wrongNetworkPage: page, mockChainState }) => {
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")

    await expect(section(page, "Actions").getByText(/Switch to Ethereum to claim/)).toBeVisible({ timeout: 10_000 })
    await expect(claimButton(page)).toBeDisabled()
  })

  test("SEF's file failing breaks only the sections that need it", async ({ connectedPage: page, mockChainState }) => {
    mockChainState.rewardsLatest = null
    mockChainState.rewardProof = REWARD_PROOFS.claimable

    await page.goto("/#/rewards")

    await expect(section(page, "Programme").getByRole("alert")).toContainText(
      "SEF's published rewards file could not be loaded.",
      { timeout: 10_000 },
    )
    await expect(section(page, "Verifiability").getByText("Not compared yet")).toBeVisible()
    await expect(valueOf(section(page, "Your rewards"), "Available to claim")).toHaveText("100 SAFE")
    await expect(claimButton(page)).toBeEnabled()
  })
})
