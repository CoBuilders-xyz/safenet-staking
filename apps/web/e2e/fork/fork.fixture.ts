/**
 * Fixtures for the fork suite. The page talks to Anvil through the same injected provider as
 * the mocked suite, in its forwarding mode, so every read and every transaction is real.
 */
import { test as base, type Page } from "@playwright/test"
import type { Address } from "viem"
import { createEthereumProviderScript } from "../mocks/ethereum-provider"
import { seedInjectedConnection, stubGeoCheck } from "../fixtures/base.fixture"
import { CHAIN_ID_HEX } from "../fixtures/test-data"
import { ANVIL_URL, chainTime, defaultAccount, fundGas, revert, snapshot } from "./chain"

type ForkFixtures = {
  /**
   * Snapshots Anvil before the test and reverts after it, pass or fail, so no test sees
   * another's transactions or clock. Automatic, so it is set up before any other fixture
   * and every funding step falls inside the snapshot.
   */
  isolatedChain: void
  /** Anvil's first default account, with gas money. Funded with SAFE only by tests that need it. */
  user: Address
  /** Connect the page's wallet as `account`, with the browser's clock set to the chain's. */
  connectAs: (account: Address) => Promise<void>
}

export const test = base.extend<ForkFixtures>({
  isolatedChain: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixture API requires this signature
    async ({}, use) => {
      const id = await snapshot()
      await use()
      await revert(id)
    },
    { auto: true },
  ],
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture API requires this signature
  user: async ({}, use) => {
    const account = await defaultAccount()
    await fundGas(account)
    await use(account) // eslint-disable-line react-hooks/rules-of-hooks -- Playwright fixture API, not a React hook
  },
  connectAs: async ({ page }, use) => {
    await use((account) => connect(page, account)) // eslint-disable-line react-hooks/rules-of-hooks -- Playwright fixture API, not a React hook
  },
})

async function connect(page: Page, account: Address): Promise<void> {
  await page.addInitScript(createEthereumProviderScript({ chainIdHex: CHAIN_ID_HEX, accounts: [account], rpcUrl: ANVIL_URL }))
  await seedInjectedConnection(page)
  await stubGeoCheck(page)
  // Anvil's clock starts at the fork block, days behind the wall clock, and the interface
  // compares claimable times with `Date.now()`. So the page runs on the chain's time, which
  // keeps flowing from there.
  await page.clock.install({ time: await chainTimeMs() })
}

/** After `warp()`: move the page's clock to the chain's again. Navigate next, so the screen recomputes. */
export async function syncBrowserClock(page: Page): Promise<void> {
  await page.clock.setSystemTime(await chainTimeMs())
}

async function chainTimeMs(): Promise<number> {
  return Number(await chainTime()) * 1000
}

export { expect } from "@playwright/test"
