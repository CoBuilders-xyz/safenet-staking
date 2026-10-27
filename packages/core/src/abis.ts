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
import { parseAbi, parseAbiItem, type ParseAbiItem } from "viem"
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

type IndexedEventEntry = (typeof INDEXED_EVENTS)[number]
type EventNameOf<S> = S extends `event ${infer N}(${string}` ? N : never

/** The names of the events registered for one contract, as literal types. */
export type IndexedEventName<C extends ContractName> =
  EventNameOf<Extract<IndexedEventEntry, { contract: C }>["signature"]>

type SignatureOf<C extends ContractName, N extends string> =
  Extract<IndexedEventEntry, { contract: C; signature: `event ${N}(${string}` }>["signature"]

/**
 * One registered event, parsed, looked up by contract and name.
 *
 * Code outside this package names the event and never writes its signature, so the only
 * signature in use is the one verify:abis proves against the chain.
 */
export function indexedEvent<C extends ContractName, N extends IndexedEventName<C>>(
  contract: C,
  name: N,
): ParseAbiItem<SignatureOf<C, N>> {
  const entry = INDEXED_EVENTS.find(
    (ev) => ev.contract === contract && ev.signature.startsWith(`event ${name}(`),
  )
  if (!entry) throw new Error(`no indexed event ${name} on ${contract}`)
  return parseAbiItem(entry.signature) as ParseAbiItem<SignatureOf<C, N>>
}

/**
 * Custom errors the interface decodes from a revert.
 *
 * A revert emits no log, so `verify:abis` cannot prove these the way it proves events. It
 * checks instead that each 4-byte selector is in the contract's deployed bytecode.
 *
 * Each one was also proven by the revert itself on 2026-10-04, with `eth_call` on `claim`:
 *  - MerkleRootWasUpdated: any account, with an `expectedMerkleRoot` other than the current root.
 *  - InvalidProof: any account, with the current root and an empty proof.
 *  - NothingToClaim: an account that had claimed everything, with its live proof from SEF.
 *
 * The staking errors were proven the same way on 2026-10-05, by `eth_call` on Mainnet from a
 * staker with stake on a registered validator, unless noted:
 *  - InvalidAmount: `stake(validator, 0)`, and `initiateWithdrawal(validator, 0)`.
 *  - NotValidator: `stake` to an address that is not a registered validator.
 *  - InvalidAddress: `stake` to the zero address.
 *  - InsufficientStake: `initiateWithdrawal` of more than the staker has on the validator.
 *  - WithdrawalQueueEmpty: `claimWithdrawal()` from an address with no withdrawal.
 *  - NoClaimableWithdrawal: `claimWithdrawal()` with only a withdrawal still in its delay. Every
 *    pending withdrawal on Mainnet was past its delay that day, so this one was proven on an
 *    Anvil fork, where the CLI's fork suite checks it on every run.
 */
export interface DecodedError {
  readonly contract: ContractName
  readonly signature: string
}

export const DECODED_ERRORS = [
  { contract: "merkleDrop", signature: "error MerkleRootWasUpdated()" },
  { contract: "merkleDrop", signature: "error InvalidProof()" },
  { contract: "merkleDrop", signature: "error NothingToClaim()" },
  { contract: "staking", signature: "error InvalidAmount()" },
  { contract: "staking", signature: "error NotValidator()" },
  { contract: "staking", signature: "error InvalidAddress()" },
  { contract: "staking", signature: "error InsufficientStake()" },
  { contract: "staking", signature: "error WithdrawalQueueEmpty()" },
  { contract: "staking", signature: "error NoClaimableWithdrawal()" },
] as const satisfies readonly DecodedError[]

type Registered = (typeof INDEXED_EVENTS)[number] | (typeof DECODED_ERRORS)[number]
type RegisteredSignatureOf<C extends ContractName, N extends string> = Extract<
  Registered,
  { contract: C; signature: `${"event" | "error"} ${N}(${string}` }
>["signature"]

/**
 * A signature from the registries above, by contract and name. ABIs below are built from it, so
 * every event and error is written once, in the entry `verify:abis` proves.
 */
function signatureOf<C extends ContractName, N extends string>(contract: C, name: N): RegisteredSignatureOf<C, N> {
  const entry = [...INDEXED_EVENTS, ...DECODED_ERRORS].find(
    (e) => e.contract === contract && /^(event|error) (\w+)\(/.exec(e.signature)?.[2] === name,
  )
  if (!entry) throw new Error(`No registered signature for ${contract}.${name}`)
  return entry.signature as RegisteredSignatureOf<C, N>
}

/**
 * The staking contract's calls, events and errors. `verify:abis` checks that every function
 * selector here is in the deployed bytecode; the events come from INDEXED_EVENTS and the errors
 * from DECODED_ERRORS above.
 */
export const stakingAbi = parseAbi([
  "function totalStakedAmount() view returns (uint256)",
  "function totalPendingWithdrawals() view returns (uint256)",
  // Verified 2026-10-04 by eth_call on Mainnet: for a staker with one open withdrawal it
  // returned one (amount, claimableAt) pair whose amount equals that WithdrawalInitiated log.
  "function getPendingWithdrawals(address staker) view returns ((uint256 amount, uint256 claimableAt)[])",
  // The head of the staker's queue, which claimWithdrawal() pays. Verified 2026-10-27 by eth_call
  // on Mainnet: for six stakers whose withdrawals were all past their delay it returned the head
  // of getPendingWithdrawals(), the oldest of two for the staker with two, and (0, 0) for nine
  // addresses with none. No staker had a withdrawal still in its delay that day, so what it
  // returns then is not proven here.
  "function getNextClaimableWithdrawal(address staker) view returns (uint256 amount, uint256 claimableAt)",
  "function stakes(address staker, address validator) view returns (uint256)",
  "function totalStakerStakes(address staker) view returns (uint256)",
  "function totalValidatorStakes(address validator) view returns (uint256)",
  "function isValidator(address validator) view returns (bool)",
  // Verified 2026-10-05 by eth_call on Mainnet: 172,800, two days in seconds.
  "function withdrawDelay() view returns (uint128)",
  // A staker's pending withdrawals are a linked list, oldest first. Verified 2026-10-05 by
  // eth_call on Mainnet: for a staker with four open withdrawals, walking `next` from head
  // reached tail in four nodes, the tail's `next` was 0, and the amounts and times equal
  // getPendingWithdrawals() in order.
  "function withdrawalQueues(address staker) view returns (uint64 head, uint64 tail)",
  "function withdrawalNodes(address staker, uint64 withdrawalId) view returns (uint256 amount, uint128 claimableAt, uint64 previous, uint64 next)",
  "function stake(address validator, uint256 amount)",
  "function initiateWithdrawal(address validator, uint256 amount)",
  // Takes no id. It pays the head of the caller's queue: proven on an Anvil fork on 2026-10-05,
  // where with withdrawals 89 and 90 open and 89 past its delay, the call paid 89.
  "function claimWithdrawal()",
  signatureOf("staking", "StakeIncreased"),
  signatureOf("staking", "WithdrawalInitiated"),
  signatureOf("staking", "WithdrawalClaimed"),
  signatureOf("staking", "ValidatorUpdated"),
  signatureOf("staking", "InvalidAmount"),
  signatureOf("staking", "NotValidator"),
  signatureOf("staking", "InvalidAddress"),
  signatureOf("staking", "InsufficientStake"),
  signatureOf("staking", "WithdrawalQueueEmpty"),
  signatureOf("staking", "NoClaimableWithdrawal"),
])

export const merkleDropAbi = parseAbi([
  "function merkleRoot() view returns (bytes32)",
  "function cumulativeClaimed(address account) view returns (uint256)",
  "function claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)",
  // The owner's root update. Nothing here sends it on Mainnet: the manual QA fork sends it on
  // an Anvil fork as the impersonated owner, and verify:abis proves both selectors in the
  // bytecode like the rest.
  "function owner() view returns (address)",
  "function setMerkleRoot(bytes32 merkleRoot)",
  signatureOf("merkleDrop", "Claimed"),
  signatureOf("merkleDrop", "MerkleRootWasUpdated"),
  signatureOf("merkleDrop", "InvalidProof"),
  signatureOf("merkleDrop", "NothingToClaim"),
])

export const sanctionsOracleAbi = parseAbi([
  "function isSanctioned(address addr) view returns (bool)",
])

/**
 * The SAFE token calls we make: balances, and the approval a stake needs. Standard ERC-20.
 * A failed transfer reverts with a reason string, such as "ERC20: insufficient allowance", not
 * a custom error.
 */
export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
])

/** The SAFE `Transfer` event, to read from a receipt what a claim paid out. */
export const safeTokenEventsAbi = parseAbi([signatureOf("safeToken", "Transfer")])

/**
 * ENS, read only to find SEF's canonical reward dataset. Standard interfaces, not Safenet's:
 * the Universal Resolver's `findResolver`, which viem's own `getEnsResolver` calls, and a
 * resolver's `contenthash` from ENSIP-7. `src/rewards-source.ts` reads them.
 */
export const ensUniversalResolverAbi = parseAbi([
  "function findResolver(bytes name) view returns (address, bytes32, uint256)",
])

export const ensResolverAbi = parseAbi([
  "function contenthash(bytes32 node) view returns (bytes)",
])
