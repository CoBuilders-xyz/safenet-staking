import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseEnv } from "node:util"

// One port per worktree, so several worktrees can run the suites at once.
// scripts/setup.sh writes them into .env.ports at the repository root. Read them here rather
// than in a package script, so they hold from the root, from apps/web, and from an editor.
// An exported variable wins. Without either, a fixed default, which is what CI uses.
const portsFile = resolve(import.meta.dirname, "../../../.env.ports")
const ports = existsSync(portsFile) ? parseEnv(readFileSync(portsFile, "utf8")) : {}

/** The web server of the mocked suite, `pnpm test:e2e`. */
export const E2E_PORT = process.env.E2E_PORT ?? ports.E2E_PORT ?? "5174"
/** The web server of the fork suite, `pnpm test:fork`. Built with other env, so never shared. */
export const FORK_PORT = process.env.FORK_PORT ?? ports.FORK_PORT ?? "5178"
/** Anvil, for the fork suite. */
export const ANVIL_PORT = process.env.ANVIL_PORT ?? ports.ANVIL_PORT ?? "8545"
