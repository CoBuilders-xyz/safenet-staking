import { test, expect } from "../fixtures/base.fixture"
import { REWARD_PROOFS, TEST_MERKLE_ROOT } from "../fixtures/test-data"
import { SEF_DATA, SEF_REWARDS_ENS_NAME } from "@cobuilders/safenet-core"
import type { Locator, Page } from "@playwright/test"

// Where the Rewards page reads SEF's files from. The mocked RPC answers the ENS name's
// contenthash from mockChainState.ensContenthash, and the fixture serves the same files from the
// repository and from every gateway, so only the source differs between these tests.

// ENSIP-7's example contenthash and its CIDv1, as core's tests decode it.
const CONTENTHASH = "0xe3010170122029f2d17be6139079dc48696d1f582a8530eb9805b561eda517e22a892c7e3f1f"
const CID = "bafybeibj6lixxzqtsb45ysdjnupvqkufgdvzqbnvmhw2kf7cfkesy7r7d4"

function section(page: Page, name: string): Locator {
  return page.getByRole("region", { name })
}

/** The value printed next to a label inside a section. */
function valueOf(region: Locator, label: string): Locator {
  return region.getByText(label, { exact: true }).locator("xpath=following-sibling::dd[1]")
}

/** Every request the page makes for a reward file, by host. */
function rewardRequests(page: Page): string[] {
  const hosts: string[] = []
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (url.pathname.endsWith(".json") && (url.pathname.includes("/ipfs/") || url.href.startsWith(SEF_DATA.rewardsProofBase))) {
      hosts.push(url.host)
    }
  })
  return hosts
}

test.describe("Rewards data source", () => {
  test("with a contenthash set, reads SEF's IPFS dataset while the repository is blocked", async ({
    connectedPage: page,
    mockChainState,
  }) => {
    mockChainState.ensContenthash = CONTENTHASH
    mockChainState.failingGateways = ["ipfs.io"]
    mockChainState.repositoryDown = true
    mockChainState.rewardProof = REWARD_PROOFS.claimable
    const requests = rewardRequests(page)

    await page.goto("/#/rewards")

    const verify = section(page, "Verifiability")
    await expect(valueOf(verify, "Source")).toHaveText("SEF's IPFS dataset (ENS), through dweb.link", { timeout: 10_000 })
    await expect(verify.getByText(TEST_MERKLE_ROOT, { exact: true })).toHaveCount(2)
    await expect(verify.getByText("Match", { exact: true })).toBeVisible()
    await expect(verify.getByRole("link", { name: "rewards/latest.json" })).toHaveAttribute(
      "href",
      `https://dweb.link/ipfs/${CID}/latest.json`,
    )

    // The proof came through the same gateway, so the claim is open.
    await expect(valueOf(section(page, "Your rewards"), "Available to claim")).toHaveText("100 SAFE", { timeout: 10_000 })
    expect(requests).not.toContain("raw.githubusercontent.com")
  })

  test("with the contenthash empty, reads the repository and says why", async ({ disconnectedPage: page }) => {
    const requests = rewardRequests(page)

    await page.goto("/#/rewards")

    const source = valueOf(section(page, "Verifiability"), "Source")
    await expect(source).toContainText("SEF's repository, through raw.githubusercontent.com", { timeout: 10_000 })
    await expect(source).toContainText(`${SEF_REWARDS_ENS_NAME} points at no dataset yet.`)
    await expect(section(page, "Verifiability").getByText("Match", { exact: true })).toBeVisible()
    expect(requests).toEqual(["raw.githubusercontent.com"])
  })
})
