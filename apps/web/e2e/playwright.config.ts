import { resolve } from "node:path"
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test"
import { MAINNET_FORK, MAINNET_FORK_SEF_DATA } from "@cobuilders/safenet-core"
import { ANVIL_PORT, E2E_PORT, FORK_PORT } from "./ports"
import { smokeTarget } from "./smoke/target"

// Three suites share this file, but never a run.
//
//   pnpm test:e2e         project `chromium`, tests/, against mocked RPC. Every pull request.
//   pnpm test:fork        project `fork`, fork/, against Anvil on a pinned Mainnet fork. Nightly.
//   pnpm test:smoke:web   project `smoke`, smoke/, against a deployment: SMOKE_URL, else
//                         PRODUCTION_URL (smoke/target.ts). After every release and deploy, and
//                         every six hours in availability.yml.
//
// The fork and smoke scripts set E2E_SUITE. The fork suite needs its own web servers, built with
// other env, and the smoke suite needs none, and Playwright's webServer is per config rather than
// per project, so the switch is here.
const suite = process.env.E2E_SUITE
const fork = suite === "fork"

const mocked: Pick<PlaywrightTestConfig, "projects" | "webServer"> = {
  projects: [
    {
      name: "chromium",
      testDir: "./tests",
      use: { browserName: "chromium", baseURL: `http://localhost:${E2E_PORT}` },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${E2E_PORT}`,
    port: Number(E2E_PORT),
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_RPC_URL: "https://mock-rpc.test",
      VITE_ALERTS_API_URL: "https://mock-alerts.test",
      VITE_STAKING_DEPLOY_BLOCK: "5000000",
      VITE_VALIDATOR_INFO_URL: "https://mock-validators.test/validators.json",
      VITE_TERMS_URL: "https://terms.test",
      VITE_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000",
      VITE_MERKLE_DROP_ADDRESS: "0x9999999999999999999999999999999999999999",
      // No VITE_REWARDS_BASE_URL: the mocked suite reads SEF's reward files the way production
      // does, through the ENS name on the mocked RPC, and the fixture serves the repository
      // and the gateways. The fork suite below keeps the override, pinned to the fork block.
      VITE_SUBGRAPH_URL_MAINNET: "https://mock-subgraph.test/mainnet",
      VITE_SUBGRAPH_URL_GNOSIS: "https://mock-subgraph.test/gnosis",
      // The sanctions screening gate, answered by the fixture from `mockChainState.sanctionsApi`.
      VITE_SANCTIONS_API_URL: "https://mock-sanctions.test/check",
    },
  },
}

const forked: Pick<PlaywrightTestConfig, "projects" | "webServer"> = {
  projects: [
    {
      name: "fork",
      testDir: "./fork",
      // One Anvil, one chain: tests run one at a time, each inside its own snapshot.
      fullyParallel: false,
      // Reads that miss Anvil's cache go to the archive node, so the first ones are slow.
      timeout: 120_000,
      expect: { timeout: 20_000 },
      use: { browserName: "chromium", baseURL: `http://localhost:${FORK_PORT}` },
    },
  ],
  webServer: [
    {
      // Never reused: a leftover Anvil holds state from another run.
      command: "node --env-file-if-exists=../../.env.local --import tsx e2e/fork/anvil.ts",
      cwd: resolve(import.meta.dirname, ".."),
      port: Number(ANVIL_PORT),
      reuseExistingServer: false,
      timeout: 120_000,
      // SIGTERM first, so the launcher passes it on and Anvil exits cleanly. SIGKILL to the
      // whole process group after the timeout, regardless.
      gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      // Never reused: a server on this port may be built for the mocks.
      command: `pnpm dev --port ${FORK_PORT} --strictPort`,
      port: Number(FORK_PORT),
      reuseExistingServer: false,
      env: {
        VITE_RPC_URL: `http://127.0.0.1:${ANVIL_PORT}`,
        // SEF's files as they stood at the fork block, not as they stand today.
        VITE_VALIDATOR_INFO_URL: MAINNET_FORK_SEF_DATA.validatorInfo,
        VITE_REWARDS_BASE_URL: MAINNET_FORK_SEF_DATA.rewardsProofBase,
        // The test accounts hold no history before the fork, so scans start there. Earlier
        // blocks would be fetched from the archive node for nothing.
        VITE_STAKING_DEPLOY_BLOCK: MAINNET_FORK.blockNumber.toString(),
        // No subgraph mock in this suite. Both chains point at the mock host, so a test that
        // lands on / asks nothing of Studio, and the overview falls back to the contract reads.
        VITE_SUBGRAPH_URL_MAINNET: "https://mock-subgraph.test/mainnet",
        VITE_SUBGRAPH_URL_GNOSIS: "https://mock-subgraph.test/gnosis",
      },
    },
  ],
}

// No web server, no mocks and no wallet: the deployment as a visitor sees it. Retried once in CI,
// because a public RPC or SEF's file can fail one request; a second failure is a finding.
const smoke = (): Pick<PlaywrightTestConfig, "projects" | "webServer"> => ({
  projects: [
    {
      name: "smoke",
      testDir: "./smoke",
      timeout: 90_000,
      expect: { timeout: 45_000 },
      use: { browserName: "chromium", baseURL: smokeTarget().url },
    },
  ],
})

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? (suite === "smoke" ? 1 : 2) : 0,
  workers: fork || process.env.CI ? 1 : undefined,
  // The smoke suite also prints each test, so the job log reads without the report.
  reporter: suite === "smoke" ? [["list"], ["html", { open: "never" }]] : "html",
  timeout: 30_000,
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  ...(fork ? forked : suite === "smoke" ? smoke() : mocked),
})
