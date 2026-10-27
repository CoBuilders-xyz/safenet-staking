import { DEPLOYMENTS, type SefValidator } from "@cobuilders/safenet-core"

/** Mainnet addresses, from core, so no address is written twice. */
export const STAKING_CONTRACT = DEPLOYMENTS[1].staking.toLowerCase()
export const TOKEN_CONTRACT = DEPLOYMENTS[1].token.toLowerCase()
/** Mock MerkleDrop contract address (set via VITE_MERKLE_DROP_ADDRESS in playwright.config.ts) */
export const MERKLE_DROP_CONTRACT = "0x9999999999999999999999999999999999999999".toLowerCase()

/** Test user address */
export const TEST_USER = "0x1111111111111111111111111111111111111111"

/**
 * Validator addresses. A and B are active. C is listed with `is_active: false`: withdrawn, like a
 * validator that left at the end of Beta. It holds no stake and has no mocked contract state.
 */
export const VALIDATORS = {
  validatorA: "0x1234567890abcdef1234567890abcdef12345678",
  validatorB: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  validatorC: "0xc0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0",
} as const

/**
 * SEF's validator-info.json as the mock serves it by default: the live file's fields, with a rate
 * per validator. SEF published a null rate for every validator from cce3fc2, 2026-10-20 09:01 UTC, until 88bf9d9, 2026-10-22 14:33 UTC;
 * a test sets one to null through `mockChainState.sefValidators`.
 */
export const SEF_VALIDATOR_INFO: readonly SefValidator[] = [
  {
    address: VALIDATORS.validatorA,
    is_active: true,
    label: "Validator A",
    commission: 0.05,
    participation_rate_14d: 0.999,
  },
  {
    address: VALIDATORS.validatorB,
    is_active: true,
    label: "Validator B",
    commission: 0.03,
    participation_rate_14d: 0.985,
  },
  {
    address: VALIDATORS.validatorC,
    is_active: false,
    label: "Validator C",
    commission: 0.05,
    // Differs from the Gnosis subgraph mock's 980 of 1,000, so a test can tell the two sources apart.
    participation_rate_14d: 0.975,
  },
]

/** Mainnet. The RPC is fully mocked, so this is the identity the app expects. */
export const CHAIN_ID = 1
export const CHAIN_ID_HEX = "0x1"

/** Sepolia, used only to simulate a wallet connected to the wrong network */
export const WRONG_CHAIN_ID_HEX = "0xaa36a7"

/** Mock block number */
export const BLOCK_NUMBER = "0x6000000"

/** Mock deploy block */
export const DEPLOY_BLOCK = 5_000_000n

/** Mock token amounts (18 decimals) */
export const AMOUNTS = {
  /** User SAFE balance: 1000 SAFE */
  userBalance: 1000n * 10n ** 18n,
  /** User total staked: 500 SAFE */
  userTotalStake: 500n * 10n ** 18n,
  /** User stake on Validator A: 300 SAFE */
  userStakeValidatorA: 300n * 10n ** 18n,
  /** User stake on Validator B: 200 SAFE */
  userStakeValidatorB: 200n * 10n ** 18n,
  /** Total staked across all: 10000 SAFE */
  totalStaked: 10_000n * 10n ** 18n,
  /** Validator A total stake: 5000 SAFE */
  validatorATotalStake: 5_000n * 10n ** 18n,
  /** Validator B total stake: 5000 SAFE */
  validatorBTotalStake: 5_000n * 10n ** 18n,
  /** Total pending withdrawals: 100 SAFE */
  totalPendingWithdrawals: 100n * 10n ** 18n,
  /** Unlimited allowance */
  unlimitedAllowance: 2n ** 256n - 1n,
  /** Withdraw delay: 7 days in seconds */
  withdrawDelay: 604800n,
  /** Pending withdrawal amount: 50 SAFE */
  pendingWithdrawalAmount: 50n * 10n ** 18n,
} as const

/** Mock transaction hash */
export const MOCK_TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

/** MerkleDrop root reported on-chain by the mock RPC (merkleRoot()) */
export const TEST_MERKLE_ROOT = "0x" + "ab".repeat(32)

/** A root that differs from TEST_MERKLE_ROOT, for root-mismatch tests */
export const OTHER_MERKLE_ROOT = "0x" + "cc".repeat(32)

/** SAFE the mocked MerkleDrop holds by default: 400 of the 1,000 allocated, so 600 claimed */
export const MERKLE_DROP_BALANCE = 400n * 10n ** 18n

/** SEF's rewards/latest.json as the mock serves it by default, agreeing with the mocked chain */
export const REWARDS_LATEST = {
  epoch: 7,
  merkleRoot: TEST_MERKLE_ROOT,
  rewardsUntil: "2026-09-22T00:00:00.000Z",
  tokenTotal: (1000n * 10n ** 18n).toString(),
  unpaidAmount: "0",
}

/** Sample reward proofs (matching public/rewards/proofs/{address}.json format) for rewards.spec.ts */
export const REWARD_PROOFS = {
  /** cumulativeAmount (100 SAFE) > claimed (0) → claimable, canClaim: true */
  claimable: {
    cumulativeAmount: (100n * 10n ** 18n).toString(),
    merkleRoot: TEST_MERKLE_ROOT,
    proof: ["0x" + "11".repeat(32)],
  },
  /** cumulativeAmount equals what the test sets as already-claimed → claimable: 0, disabled */
  fullyClaimed: {
    cumulativeAmount: (50n * 10n ** 18n).toString(),
    merkleRoot: TEST_MERKLE_ROOT,
    proof: ["0x" + "11".repeat(32)],
  },
  /** proof's embedded root doesn't match the mocked on-chain root → rootStale, disabled */
  staleRoot: {
    cumulativeAmount: (100n * 10n ** 18n).toString(),
    merkleRoot: OTHER_MERKLE_ROOT,
    proof: ["0x" + "11".repeat(32)],
  },
  /** claimable, with the KYC fields serialised as null rather than omitted; null means absent */
  kycNull: {
    cumulativeAmount: (100n * 10n ** 18n).toString(),
    merkleRoot: TEST_MERKLE_ROOT,
    proof: ["0x" + "11".repeat(32)],
    kycAmount: null,
    kyc: null,
  },
  /** part of the claimable amount is pending compliance review (kyc !== true) */
  partialKyc: {
    cumulativeAmount: (100n * 10n ** 18n).toString(),
    merkleRoot: TEST_MERKLE_ROOT,
    proof: ["0x" + "11".repeat(32)],
    kycAmount: (50n * 10n ** 18n).toString(),
    kyc: false,
  },
}

/** Gas estimation values */
export const GAS = {
  estimateGas: "0x30d40", // 200000
  gasPrice: "0x3b9aca00", // 1 gwei
} as const
