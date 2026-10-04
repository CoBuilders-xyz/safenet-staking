/**
 * Event signatures we index.
 *
 * THE RULE: no source file is authoritative. Only the chain is.
 * The deployed contracts match NEITHER published branch of safe-research/safenet:
 * the `beta` tag is older than what is deployed, `main` is newer. So every signature here
 * is proven against live logs by matching keccak topic0, never taken from a branch.
 *
 * `scripts/verify-abis.ts` re-proves these against the chain: the "high" entries on every run,
 * and the "rare" entries under --deep, which scans from each contract's deploy block.
 * If it fails, the world changed. Do not "fix" the signature by reading a branch.
 */
import { parseAbi } from "viem"
import type { ContractName } from "./contracts.js"

/**
 * `frequency` decides how we verify:
 *  - "high" events appear constantly, so a short recent window proves them. Runs on every PR.
 *  - "rare" events need a scan from the deploy block. Runs nightly, not per PR.
 */
export interface IndexedEvent {
  readonly contract: ContractName
  readonly signature: string
  readonly frequency: "high" | "rare"
}

export const INDEXED_EVENTS = [
  // --- Ethereum Mainnet: staking ---
  { contract: "staking", frequency: "rare",
    signature: "event StakeIncreased(address indexed staker, address indexed validator, uint256 amount)" },
  { contract: "staking", frequency: "rare",
    signature: "event WithdrawalInitiated(address indexed staker, address indexed validator, uint64 indexed withdrawalId, uint256 amount)" },
  { contract: "staking", frequency: "rare",
    signature: "event WithdrawalClaimed(address indexed staker, uint64 indexed withdrawalId, uint256 amount)" },
  { contract: "staking", frequency: "rare",
    signature: "event ValidatorUpdated(address indexed validator, bool isRegistered)" },

  // --- Ethereum Mainnet: rewards ---
  { contract: "merkleDrop", frequency: "rare",
    signature: "event Claimed(address indexed account, uint256 amount)" },


  // The contract spells it "Merkel". That is not a transcription error on our side: the typo
  // is in the deployed bytecode, and topic0 only matches the misspelling.
  //
  // Neither parameter is indexed, and the order is (old, new). Both determined from real logs
  // on 2026-09-29, not from the signature: a log carries one topic, so no parameter is indexed,
  // and each log's first word equals the previous log's second. topic0 alone cannot tell us
  // either fact, because it does not encode which parameters are indexed.
  { contract: "merkleDrop", frequency: "rare",
    signature: "event MerkelRootUpdated(bytes32 oldRoot, bytes32 newRoot)" },
  // --- Gnosis Chain: consensus ---
  { contract: "consensus", frequency: "high",
    signature: "event TransactionAttested(bytes32 indexed safeTxHash, uint256 indexed chainId, address indexed safe, uint64 epoch, bytes32 signatureId, ((uint256 x, uint256 y) r, uint256 z) attestation)" },
  { contract: "consensus", frequency: "rare",
    signature: "event ValidatorStakerSet(address indexed validator, address staker)" },

  // --- Gnosis Chain: FROST coordinator (drives participation) ---
  { contract: "frostCoordinator", frequency: "high",
    signature: "event SignShared(bytes32 indexed sid, bytes32 indexed selectionRoot, address participant, uint256 z)" },
  { contract: "frostCoordinator", frequency: "high",
    signature: "event SignCompleted(bytes32 indexed sid, bytes32 indexed selectionRoot, ((uint256 x, uint256 y) r, uint256 z) signature)" },
  { contract: "frostCoordinator", frequency: "rare",
    signature: "event KeyGenConfirmed(bytes32 indexed gid, address participant, bool confirmed)" },

  // These three are indexed by the metrics work. They are declared here rather than inside
  // the script, so verify:abis proves them against the chain.
  { contract: "consensus", frequency: "high",
    signature: "event TransactionProposed(bytes32 indexed safeTxHash, uint256 indexed chainId, address indexed safe, uint64 epoch, (uint256 chainId, address safe, address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 nonce) transaction)" },
  { contract: "consensus", frequency: "high",
    signature: "event EpochRolledOver(uint64 indexed newActiveEpoch)" },
  { contract: "safeToken", frequency: "rare",
    signature: "event Transfer(address indexed from, address indexed to, uint256 value)" },
] as const satisfies readonly IndexedEvent[]

/** Read-only calls the interface and the CLI both make. */
export const stakingAbi = parseAbi([
  "function totalStakedAmount() view returns (uint256)",
  "function totalPendingWithdrawals() view returns (uint256)",
  "function stakes(address staker, address validator) view returns (uint256)",
  "function totalStakerStakes(address staker) view returns (uint256)",
  "function totalValidatorStakes(address validator) view returns (uint256)",
  "function isValidator(address validator) view returns (bool)",
  "function stake(address validator, uint256 amount)",
  "function initiateWithdrawal(address validator, uint256 amount)",
  "function claimWithdrawal()",
])

export const merkleDropAbi = parseAbi([
  "function merkleRoot() view returns (bytes32)",
  "function cumulativeClaimed(address account) view returns (uint256)",
  "function claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)",
])

export const sanctionsOracleAbi = parseAbi([
  "function isSanctioned(address addr) view returns (bool)",
])

/** The one ERC-20 read we make: the SAFE balance held by the MerkleDrop. Standard ERC-20. */
export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
])
