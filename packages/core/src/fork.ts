/**
 * The Mainnet state the forks run against: `pnpm test:fork` in apps/web and in packages/cli each
 * start Anvil on a fork of this block, and the manual QA fork, `pnpm fork:up`, starts from it
 * unless QA_FORK_BLOCK names another. A test fixture, not a production constant. Nothing but
 * those three reads it.
 *
 * The block and SEF's data commit are pinned together, and must move together. SEF overwrites
 * its proof files on `main` with every new Merkle root, so a pinned block read with proofs from
 * `main` stops verifying at the next fortnightly update. Read at one commit, they match forever.
 *
 * Chosen 2026-10-05. Block 26,122,454 is the first block after 00:03 UTC, a few seconds after
 * SEF's data commit 4cdcc6e (00:02:56 UTC). The root of rewards period 12, published
 * 2026-09-24, was the last root update before both, so the root on chain at the block equals
 * the root in that commit's proof files. Both suites check this on every run.
 */
import { SEF_DATA_REPO } from "./contracts.js"

export const MAINNET_FORK = {
  blockNumber: 26_122_454n,
  sefData: {
    repo: SEF_DATA_REPO,
    commit: "4cdcc6e1d672b79a5f84a2e9c67bfe4aa353a6d7",
  },
} as const

const sefDataAtCommit = `https://raw.githubusercontent.com/${MAINNET_FORK.sefData.repo}/${MAINNET_FORK.sefData.commit}/assets`

/** SEF's files as they stood at the pinned commit. Same layout as `SEF_DATA`. */
export const MAINNET_FORK_SEF_DATA = {
  validatorInfo: `${sefDataAtCommit}/validator-info.json`,
  rewardsProofBase: `${sefDataAtCommit}/rewards`,
  /**
   * The GitHub API listing of every proof file at the commit, one request. raw.githubusercontent
   * serves files but cannot list a directory.
   */
  proofTree: `https://api.github.com/repos/${MAINNET_FORK.sefData.repo}/git/trees/${MAINNET_FORK.sefData.commit}:assets/rewards/proofs?recursive=1`,
} as const

/**
 * Anvil's and Hardhat's public test mnemonic. Anvil unlocks the accounts it derives, its keys are
 * published, and they hold nothing on Mainnet that matters. The fork suites and the manual QA
 * fork sign with account 0. A test fixture, like the rest of this file.
 */
export const ANVIL_TEST_MNEMONIC = "test test test test test test test test test test test junk"
