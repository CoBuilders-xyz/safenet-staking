/**
 * Contract addresses and deploy blocks.
 *
 * THIS FILE IS THE ONLY PLACE THESE VALUES ARE WRITTEN.
 * Never type a hex address anywhere else in this repository.
 *
 * Source: safe-fndn/safenet-data/config/beta.env, cross-checked against
 * the Security page of SEF's documentation. Verified 2026-08-26. The Aegis entries name
 * their own sources.
 */
import type { Address } from "viem"
import type { ChainKey } from "./chains.js"
import type { Programme } from "./sef.js"

export interface ContractRef {
  readonly address: Address
  readonly chain: ChainKey
  /**
   * Floor for historical scans by verify:abis. May sit earlier than the deploy, which is
   * harmless for a scan that only looks for a signature.
   */
  readonly startBlock?: bigint
  /**
   * The block the contract was deployed in, verified by eth_getCode: no code at
   * deployBlock - 1, code at deployBlock. An indexer must start here, not at startBlock,
   * or it reads blocks where the contract does not exist.
   */
  readonly deployBlock?: bigint
  /**
   * The programme a contract belongs to, when one programme owns it. Once PROGRAMME_CLOSED_FROM
   * in sef.ts closes that programme, verify:abis scans the contract back from the programme's
   * last block instead of the chain head.
   */
  readonly programme?: Programme
}

export const CONTRACTS = {
  staking: {
    address: "0x115E78f160e1E3eF163B05C84562Fa16fA338509",
    chain: "mainnet",
    startBlock: 24_585_750n,
    // Verified 2026-09-29: no code at 24,585,749, 16,432 bytes at 24,585,750.
    deployBlock: 24_585_750n,
  },
  safeToken: {
    address: "0x5aFE3855358E112B5647B952709E6165e1c1eEEe",
    chain: "mainnet",
    // Scan floor for verify:abis, NOT the deploy block. The token deployed at 14,624,496.
    startBlock: 24_585_750n,
  },
  merkleDrop: {
    address: "0xe5139Fc0FB8eae81e30d8a85C22E88c6757120f2",
    chain: "mainnet",
    startBlock: 24_585_750n,
    // Verified 2026-09-29: no code at 24,749,706, 1,792 bytes at 24,749,707. That is
    // 164,000 blocks after the scan floor above, which an indexer must not waste.
    deployBlock: 24_749_707n,
  },
  sanctionsList: {
    address: "0x40C57923924B5c5c5455c48D93317139ADDaC8fb",
    chain: "mainnet",
    startBlock: 14_356_508n,
  },
  delegateRegistry: {
    address: "0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446",
    chain: "mainnet",
    startBlock: 11_225_329n,
  },
  consensus: {
    address: "0x223624cBF099e5a8f8cD5aF22aFa424a1d1acEE9",
    chain: "gnosis",
    startBlock: 45_210_396n,
    deployBlock: 45_210_396n,
    programme: "beta",
  },
  frostCoordinator: {
    // SEF publishes no start block for this one, and we asked on 2026-08-27. We then found it
    // ourselves: the coordinator deployed one block BEFORE the consensus contract. Verified by
    // scanning from this block and confirming the same 1,885 keygen groups.
    address: "0xaE27021CEB45316f1efe69D8E362aC07ED3Bd7E4",
    chain: "gnosis",
    startBlock: 45_210_395n,
    deployBlock: 45_210_395n,
    programme: "beta",
  },
  // Aegis, on Gnosis since October 2026. Addresses from SEF's README at safe-fndn/safenet-data
  // 1c18bdc (consensus and SentinelOracle) and the Contracts and Audits page of SEF's Aegis
  // documentation (all three), which agreed on 2026-10-27. Deploy blocks found that day by binary
  // search over eth_getCode; neither source publishes one.
  aegisConsensus: {
    address: "0xc855761D619f6002923507cE68B84d7689C2aa96",
    chain: "gnosis",
    // Verified 2026-10-27: no code at 48,635,842, 8,049 bytes at 48,635,843.
    startBlock: 48_635_843n,
    deployBlock: 48_635_843n,
    programme: "aegis",
  },
  aegisFrostCoordinator: {
    // The README does not name it. The docs page does, and the chain agrees: getCoordinator() on
    // aegisConsensus returned this address on 2026-10-27. Unlike Beta's, it deployed well BEFORE
    // its consensus contract, 18,022 blocks or about 25 hours, and signed its first ceremonies
    // before the consensus contract existed.
    address: "0xC6B34dA4c99C043A093214D58423a8bE39585B78",
    chain: "gnosis",
    // Verified 2026-10-27: no code at 48,617,820, 14,345 bytes at 48,617,821.
    startBlock: 48_617_821n,
    deployBlock: 48_617_821n,
    programme: "aegis",
  },
  aegisSentinelOracle: {
    // The oracle every Aegis transaction proposal names: each TransactionProposed and
    // TransactionAttested on aegisConsensus to 2026-10-27 carried this address as `oracle`.
    address: "0x4F61B8832978e83b80D69551AEf07557DBE41d03",
    chain: "gnosis",
    // Verified 2026-10-27: no code at 48,635,849, 16,812 bytes at 48,635,850.
    startBlock: 48_635_850n,
    deployBlock: 48_635_850n,
    programme: "aegis",
  },
} as const satisfies Record<string, ContractRef>

export type ContractName = keyof typeof CONTRACTS

/** The Gnosis contracts of one programme, by the role each plays. */
export interface GnosisProgrammeContracts {
  readonly consensus: ContractName
  readonly frostCoordinator: ContractName
  /** Aegis only. Beta checked transactions without an oracle. */
  readonly sentinelOracle?: ContractName
}

/**
 * Which entry of CONTRACTS plays which role in each programme. Beta's keys predate Aegis and keep
 * their names, so code written for Beta still reads Beta.
 */
export const GNOSIS_CONTRACTS: Readonly<Record<Programme, GnosisProgrammeContracts>> = {
  beta: { consensus: "consensus", frostCoordinator: "frostCoordinator" },
  aegis: {
    consensus: "aegisConsensus",
    frostCoordinator: "aegisFrostCoordinator",
    sentinelOracle: "aegisSentinelOracle",
  },
}

/**
 * The GitHub repository where SEF publishes its data. It was `safenet-beta-data` until SEF
 * renamed it. GitHub still answered the old name on 2026-10-06: the raw host served it as if
 * nothing had changed, and the API answered a 301 to a repository id. That is GitHub's to keep,
 * not SEF's publication, so nothing here relies on it.
 */
export const SEF_DATA_REPO = "safe-fndn/safenet-data"

const SEF_RAW = `https://raw.githubusercontent.com/${SEF_DATA_REPO}`
const SEF_API = `https://api.github.com/repos/${SEF_DATA_REPO}`

/** Where SEF publishes the data our numbers must match. */
export const SEF_DATA = {
  validatorInfo: `${SEF_RAW}/main/assets/validator-info.json`,
  networkInfo: `${SEF_RAW}/main/assets/network-info.json`,
  /**
   * The reward files in the repository. From the first Aegis distribution SEF names the IPFS
   * dataset behind `rewards.safenet-gov.eth` canonical and keeps the repository as a temporary
   * mirror, so readers try that dataset first: see src/rewards-source.ts.
   */
  rewardsLatest: `${SEF_RAW}/main/assets/rewards/latest.json`,
  rewardsProofBase: `${SEF_RAW}/main/assets/rewards`,
  /**
   * The last commit that wrote validator-info.json, through the GitHub API. Its time is when
   * SEF published the participation rates, which fixes the window they cover.
   */
  validatorInfoCommits: `${SEF_API}/commits?path=assets/validator-info.json&per_page=1`,
  /** The last commit that wrote network-info.json. The same cron writes it, in the same commit. */
  networkInfoCommits: `${SEF_API}/commits?path=assets/network-info.json&per_page=1`,
  /** A file under `assets/` at one commit, so the rates and their window come from one write. */
  assetsAtCommit: (sha: string) => `${SEF_RAW}/${sha}/assets`,
  /** Their cron runs every 3 hours. Three missed runs is our staleness threshold. */
  staleAfterMs: 9 * 60 * 60 * 1000,
  /** Eight missed runs: past this, a parity run fails, because SEF's pipeline has stopped. */
  expiredAfterMs: 24 * 60 * 60 * 1000,
} as const
