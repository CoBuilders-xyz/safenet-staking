import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"
import { defineConfig } from "@playwright/test"

// One port per worktree, so several worktrees can run the suite at once.
// scripts/setup.sh writes one into .env.ports at the repository root. Read it here rather
// than in a package script, so the port holds from the root, from apps/web, and from an
// editor. An exported E2E_PORT wins. Without either, the reference's own port.
const portsFile = resolve(import.meta.dirname, "../../../.env.ports")
const ports = existsSync(portsFile) ? parseEnv(readFileSync(portsFile, "utf8")) : {}
const E2E_PORT = process.env.E2E_PORT ?? ports.E2E_PORT ?? "5174"

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${E2E_PORT}`,
    port: Number(E2E_PORT),
    reuseExistingServer: !process.env.CI,
    env: {
      VITE_RPC_URL: "https://mock-rpc.test",
      VITE_STAKING_DEPLOY_BLOCK: "5000000",
      VITE_VALIDATOR_INFO_URL: "https://mock-validators.test/validators.json",
      VITE_TERMS_URL: "https://terms.test",
      VITE_WALLETCONNECT_PROJECT_ID: "00000000000000000000000000000000",
      VITE_MERKLE_DROP_ADDRESS: "0x9999999999999999999999999999999999999999",
      VITE_REWARDS_BASE_URL: "https://mock-rewards.test",
    },
  },
})
