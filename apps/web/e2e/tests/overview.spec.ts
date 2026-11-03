import { test, expect } from "../fixtures/base.fixture"
import { GNOSIS_SNAPSHOT } from "@cobuilders/safenet-core"
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
    // SEF's flag, not the subgraph's registered count: Validator C is withdrawn.
    const counts = page.getByRole("group", { name: "Active validators" })
    await expect(counts).toContainText("2 active")
    await expect(counts).toContainText("1 withdrawn")
    await expect(counts).toContainText("SEF's published validator list")
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("4,800")
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("Gnosis subgraph")
    await expect(page.getByRole("group", { name: "Attestation latency" })).toContainText("~20 s")

    const stakeHistory = page.getByRole("region", { name: "Total SAFE staked over time" })
    await expect(stakeHistory.getByRole("img", { name: "Total SAFE staked over time" })).toBeVisible()
    await expect(stakeHistory.getByRole("table")).toContainText("12,345")
    const attestationHistory = page.getByRole("region", { name: "Attestations per day" })
    await expect(attestationHistory.getByRole("img", { name: "Attestations per day" })).toBeVisible()
    await expect(attestationHistory.getByRole("table")).toContainText("4,800")
    await stakeHistory.getByRole("button", { name: "7 days" }).click()
    await expect(stakeHistory.getByRole("button", { name: "7 days" })).toHaveAttribute("aria-pressed", "true")
    await expect(page.getByText(/estimated APY/i)).toHaveCount(0)

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
    await expect(validators.getByRole("link", { name: "Validator A", exact: true })).toHaveAttribute("href", new RegExp(`#/validators/${VALIDATORS.validatorA}$`, "i"))
    await expect(validators).toContainText("7,000")
    await expect(validators).toContainText("99.00%")
    await expect(validators).toContainText("140 missed")
    await expect(validators.getByRole("link", { name: "Stake with Validator A" })).toHaveAttribute("href", new RegExp(`#/validators\\?delegate=${VALIDATORS.validatorA}$`, "i"))
    const withdrawn = validators.getByRole("row").filter({ has: page.getByRole("link", { name: "Validator C", exact: true }) })
    await expect(withdrawn).toContainText("Withdrawn, Aegis participation unconfirmed")
    // The subgraph's rate, 980 of 1,000, not SEF's published 97.50%: the subgraph is live.
    await expect(withdrawn).toContainText("98.00%")
    await expect(withdrawn).not.toContainText("97.50%")
    await expect(withdrawn.getByRole("link", { name: /^Stake/ })).toHaveCount(0)

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

    await expect(page.getByRole("region", { name: "Total SAFE staked over time" })).toContainText("The subgraph could not be queried.")
    await expect(page.getByRole("region", { name: "Attestations per day" })).toContainText("The subgraph could not be queried.")

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
    await expect(page.getByRole("region", { name: "Total SAFE staked over time" })).toContainText("past the 15 min limit")
    await expect(page.getByRole("region", { name: "Attestations per day" }).getByRole("img")).toBeVisible()
    // The Gnosis subgraph is still fresh, so its figures stay.
    await expect(page.getByRole("group", { name: "Attestations per day" })).toContainText("4,800")
  })

  test("keeps the stake chart when the Gnosis index is stale", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.gnosis = "stale"
    await page.goto("/")
    await expect(page.getByRole("region", { name: "Attestations per day" })).toContainText("past the 15 min limit")
    await expect(page.getByRole("region", { name: "Total SAFE staked over time" }).getByRole("img")).toBeVisible()
  })

  test("shows Aegis days from the subgraph, with no Beta notice", async ({ disconnectedPage: page }) => {
    await page.goto("/")

    // The mocked Gnosis subgraph holds Aegis days to today, as the live one does while Aegis attests.
    const attestations = page.getByRole("group", { name: "Attestations per day" })
    await expect(attestations).toContainText("4,800")
    await expect(attestations).toContainText("Gnosis subgraph, complete UTC days")
    await expect(attestations).toContainText("Mean over 14 complete days, range 4,800 to 4,800")
    await expect(attestations).not.toContainText("Beta")
    await expect(page.getByRole("group", { name: "Attestation latency" })).not.toContainText("Beta")
    const validators = page.getByRole("region", { name: "Validators" })
    await expect(validators).toContainText("the Gnosis subgraph, attestation ceremonies attended over 14 complete UTC days to")
    await expect(validators).toContainText("99.00%")
    await expect(validators).not.toContainText("Beta,")
    await expect(page.getByRole("note", { name: "Beta ended" })).toHaveCount(0)
  })

  test("shows indexed zero attendance and absences without falling back to SEF", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.gnosisZeroAttendance = true
    await page.goto("/")
    const row = page.getByRole("region", { name: "Validators" }).getByRole("row").filter({ hasText: "Validator B" })
    await expect(row).toContainText("0.00%")
    await expect(row).toContainText("14,000")
    await expect(row).not.toContainText("SEF file")
  })

  test("shows Beta's dated figures, with the Beta notice, while the index holds no Aegis day", async ({ disconnectedPage: page, mockSubgraph }) => {
    mockSubgraph.gnosisAegis = false
    await page.goto("/")

    // The subgraph is live but holds no Aegis day, so the figures are the snapshot measured during Beta.
    const notes = page.getByRole("note", { name: "Beta ended" })
    await expect(notes.first()).toHaveText("Beta ended on 5 October 2026. Aegis data starts on 13 October 2026.")
    const attestations = page.getByRole("group", { name: "Attestations per day" })
    await expect(attestations).toContainText(GNOSIS_SNAPSHOT.attestationsPerDay.toLocaleString("en-US"))
    await expect(attestations).toContainText("Snapshot measured")
    await expect(attestations).toContainText("The Gnosis subgraph has not indexed a complete UTC day yet.")
    await expect(page.getByRole("status", { name: "Data freshness" })).toContainText("Gnosis subgraph: live")
  })

  test("needs no wallet: the overview renders without one connected", async ({ disconnectedPage: page }) => {
    await page.goto("/")
    await expect(page.getByRole("button", { name: "Connect Wallet" })).toBeVisible()
    await expect(page.getByRole("group", { name: "Total SAFE staked" })).toContainText("12,345")
  })
})

test.describe("My stake route", () => {
  test("My stake lives at /dashboard, one click from the overview", async ({ connectedPage: page }) => {
    await page.goto("/")
    await page.getByRole("link", { name: "Manage my stake" }).click()
    await expect(page).toHaveURL("/#/dashboard")
    await expect(page.getByRole("heading", { name: "Stake your SAFE" })).toBeVisible()
    await expect(page.getByText("Your Staked SAFE")).toBeVisible({ timeout: 10_000 })
  })

  test("every deep link that existed before still lands on its page", async ({ disconnectedPage: page }) => {
    // Each check is content only that page renders. The header nav says "Validators", "Withdrawals"
    // and "Rewards" on every page, the 404 included, so a nav label proves nothing.
    const links: [string, (p: typeof page) => ReturnType<typeof page.getByRole>][] = [
      ["/#/validators", (p) => p.getByRole("heading", { name: "Safenet validators" })],
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
