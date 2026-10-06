import { test, expect } from "../fixtures/base.fixture"
import { VALIDATORS } from "../fixtures/test-data"

/**
 * The Network Overview at `/`. The subgraph endpoints are mocked in mocks/subgraph-handler.ts
 * with figures that differ from the mocked contract reads: 12,345 SAFE staked by the subgraph,
 * 10,000 by the contract. So each test can tell which source a figure came from.
 */
test.describe("Network Overview", () => {
  test("renders every section from the subgraphs, with freshness", async ({ disconnectedPage: page }) => {
    await page.goto("/")

    await expect(page.getByRole("heading", { name: "Network overview" })).toBeVisible()
    const freshness = page.getByRole("status", { name: "Data freshness" })
    await expect(freshness).toContainText("Mainnet subgraph: live. Last indexed block 25,900,000")
    await expect(freshness).toContainText("Gnosis subgraph: live. Last indexed block 48,600,000")

    await expect(page.getByRole("group", { name: "Total SAFE staked" })).toContainText("12,345")
    await expect(page.getByRole("group", { name: "Total SAFE staked" })).toContainText("Mainnet subgraph")
    await expect(page.getByRole("group", { name: "Active validators" })).toContainText("2")
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("4,800")
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("Gnosis subgraph")
    await expect(page.getByRole("group", { name: "Attestation latency" })).toContainText("~20 s")

    const distribution = page.getByRole("region", { name: "Stake distribution" })
    // 7,000 and 5,345 of 12,345: 56.7% and 43.3%, so HHI 3,215 + 1,875.
    await expect(distribution).toContainText("HHI 5,090")
    await expect(distribution).toContainText("56.7%")

    const rewards = page.getByRole("region", { name: "Rewards" })
    await expect(rewards).toContainText("1,000 SAFE")
    await expect(rewards).toContainText("650 SAFE")
    await expect(rewards).toContainText("350 SAFE")
    await expect(rewards.getByText("Match")).toBeVisible()

    const validators = page.getByRole("region", { name: "Validators" })
    await expect(validators.getByRole("link", { name: "Validator A" })).toHaveAttribute("href", new RegExp(`#/validators/${VALIDATORS.validatorA}$`, "i"))
    await expect(validators).toContainText("7,000")
    await expect(validators).toContainText("99.00%")
    await expect(validators).toContainText("140 missed")

    const activity = page.getByRole("region", { name: "Last 30 days" })
    await expect(activity).toContainText("37")
    await expect(activity).toContainText("300 SAFE")
  })

  test("falls back to contract reads and the snapshot, and says so, when the subgraphs fail", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.mainnet = "fail"
    mockSubgraph.gnosis = "fail"
    await page.goto("/")

    const freshness = page.getByRole("status", { name: "Data freshness" })
    await expect(freshness).toContainText(
      "Mainnet subgraph: not used. The subgraph could not be queried. Staking and rewards figures are read directly from the contracts on Ethereum instead.",
      { timeout: 15_000 },
    )
    await expect(freshness).toContainText("Attestation figures come from a snapshot measured Tue 29 Sep 2026, 14:41 UTC")

    const total = page.getByRole("group", { name: "Total SAFE staked" })
    await expect(total).toContainText("10,000")
    await expect(total).toContainText("Read directly from the contracts on Ethereum")
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("Snapshot measured Tue 29 Sep 2026, 14:41 UTC")

    // The MerkleDrop's live balance: 600 claimed, 400 unclaimed of 1,000.
    const rewards = page.getByRole("region", { name: "Rewards" })
    await expect(rewards).toContainText("600 SAFE")
    await expect(rewards).toContainText("400 SAFE")

    // Per-validator stakes from the contract, 5,000 each; participation from SEF's file.
    const validators = page.getByRole("region", { name: "Validators" })
    await expect(validators).toContainText("5,000")
    await expect(validators).toContainText("99.90%")

    // A figure with no contract fallback says why it is missing.
    await expect(page.getByRole("region", { name: "Last 30 days" })).toContainText(
      "Unavailable. The subgraph could not be queried. No contract read gives a daily history.",
    )
  })

  test("treats a stale subgraph like a failed one", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.mainnet = "stale"
    await page.goto("/")

    await expect(page.getByRole("status", { name: "Data freshness" })).toContainText(
      "The subgraph's last indexed block, 25,900,000, is 1 h old, past the 15 min limit.",
      { timeout: 15_000 },
    )
    await expect(page.getByRole("group", { name: "Total SAFE staked" })).toContainText("10,000")
    // The Gnosis subgraph is still fresh, so its figures stay.
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("4,800")
  })

  test("needs no wallet: the overview renders without one connected", async ({ disconnectedPage: page }) => {
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible()
    await expect(page.getByRole("group", { name: "Total SAFE staked" })).toContainText("12,345")
  })
})

test.describe("Dashboard route", () => {
  test("the staking dashboard lives at /dashboard, one click from the overview", async ({ connectedPage: page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Open the staking dashboard" }).click()
    await expect(page).toHaveURL("/#/dashboard")
    await expect(page.getByRole("heading", { name: "Stake your SAFE" })).toBeVisible()
    await expect(page.getByText("Your Staked SAFE")).toBeVisible({ timeout: 10_000 })
  })

  test("every deep link that existed before still lands on its page", async ({ disconnectedPage: page }) => {
    // Each check is content only that page renders. The header nav says "Validators", "Withdrawals"
    // and "Rewards" on every page, the 404 included, so a nav label proves nothing.
    const links: [string, (p: typeof page) => ReturnType<typeof page.getByRole>][] = [
      ["/#/validators", (p) => p.getByRole("heading", { name: "Safenet Beta" })],
      [`/#/validators/${VALIDATORS.validatorA}`, (p) => p.getByRole("link", { name: "Back to Validators" })],
      ["/#/withdrawals", (p) => p.getByRole("heading", { name: "Withdrawals", exact: true })],
      ["/#/rewards", (p) => p.getByRole("heading", { name: "Rewards", exact: true })],
    ]
    for (const [path, unique] of links) {
      await page.goto(path)
      await expect(unique(page)).toBeVisible({ timeout: 10_000 })
      await expect(page.getByRole("heading", { name: "404" })).toHaveCount(0)
    }
  })
})
