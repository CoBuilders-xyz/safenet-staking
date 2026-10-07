# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Build:** `yarn build` (runs `tsc -b && vite build`)
- **Dev server:** `yarn dev`
- **Lint:** `yarn lint`
- **Type check only:** `npx tsc --noEmit`
- **Preview production build:** `yarn preview`
- **Run unit/integration tests:** `yarn test` (vitest run)
- **Check:** `pnpm check` (`codegen:check`, which fails if `src/graphql/<chain>/generated.ts` is stale, then eslint and `tsc -b --noEmit`; also run in CI)
- **GraphQL types:** `pnpm codegen` regenerates them; `pnpm codegen:live-check` validates the documents against a running graph-node
- **Watch mode:** `yarn test:watch`
- **Coverage:** `yarn test:coverage`
- **E2E tests:** `yarn test:e2e` (Playwright)
- **Generate Merkle proofs:** `pnpm generate:proofs [--out <dir>]` (reads `scripts/merkle-config.json`, writes to the git-ignored `.rewards/` by default)
- **Manual QA fork:** `pnpm fork:up`, `pnpm fork:reset`, `pnpm fork:down`, from the repository root or here. The tool is `scripts/fork-env/`; the guide is `docs/manual-qa-fork.md` at the repository root

## Pre-push Checklist

Before pushing code to the remote, always run these checks in order and fix any failures:

1. `yarn lint` — ESLint must pass with zero errors
2. `yarn test` — All unit/integration tests must pass
3. `yarn build` — Production build must succeed (includes `tsc -b`)

## Architecture

Safenet Staking UI is a React 19 + TypeScript dApp for delegating SAFE tokens to validators on Ethereum. It uses Vite 7, Tailwind CSS 4 (via `@tailwindcss/vite`), wagmi 3 / viem for wallet and contract interactions, and recharts for data visualization.

### Provider Stack (src/main.tsx)

`StrictMode` → `WagmiProvider` → `QueryClientProvider` → `TooltipProvider` → `ToastProvider` → `App`

All wagmi hooks, React Query, Radix tooltip context, and toast context are available throughout the app.

### Routing (src/App.tsx)

Seven routes under a shared `Layout` (header + footer + `<Outlet />`), wrapped in `ErrorBoundary`:
- `/` → `OverviewPage` (Network Overview, no wallet needed: headline figures, stake distribution with HHI, rewards with the root check, validator table, last 30 days, and a freshness line per subgraph)
- `/dashboard` → `DashboardPage` (stats, claimable banner, quick actions, rewards, staking section, stake distribution chart)
- `/validators` → `ValidatorsPage` (validator cards with delegate/undelegate; supports `?delegate=0x...` deep-link to auto-open delegate dialog)
- `/validators/:address` → `ValidatorDetailPage` (full validator info, delegate/undelegate buttons)
- `/withdrawals` → `WithdrawalsPage` (pending withdrawal queue with FIFO tooltip, cooldown progress bars, claim)
- `/rewards` → `RewardsPage` (your rewards, Claim & Stake, claim, programme totals, and the on-chain root checked against SEF's published one)
- `*` → `NotFoundPage` (404 catch-all)

All pages are lazy-loaded with `React.lazy()` and preloaded via `requestIdleCallback` in a `useEffect` with cleanup.

App-level guards: `useSanctionsCheck` blocks the entire app if `VITE_SANCTIONS_API_URL` returns 403. `useGeoblockCheck` blocks access from OFAC/ITAR-restricted countries via `api.country.is` (fails open). `WalletSanctionsGate` blocks individual wallet addresses flagged by the sanctions API. `DisconnectWatcher` shows a toast on wallet disconnect.

### Contract Integration

- **Config layer:** `src/config/chains.ts` resolves chain from `VITE_CHAIN_ID`, `src/config/contracts.ts` maps chain IDs to staking/token/merkleDrop contract addresses.
- **ABIs:** `src/abi/stakingAbi.ts` (staking contract) and `src/abi/erc20Abi.ts` (SAFE token). ABIs use viem's `parseAbi` with human-readable signatures. `src/abi/merkleDropAbi.ts` re-exports the MerkleDrop ABI from `@cobuilders/safenet-core`, whose events and errors `verify:abis` proves against the chain.
- **Read hooks** (`src/hooks/useStakingReads.ts`): Thin wrappers around wagmi's `useReadContract`/`useReadContracts`. Per-user hooks guard with `query: { enabled: !!address }`. All hooks poll every 15 seconds via `refetchInterval: 15_000`.
- **Write hooks** (`src/hooks/useStakingWrites.ts`): Each write hook (`useStake`, `useInitiateWithdrawal`, `useClaimWithdrawal`) combines `useWriteContract` + `useWaitForTransactionReceipt` and returns a unified `{ action, isPending, isSuccess, error, reset, txHash }` interface. Cache invalidation uses targeted `predicate`-based queries via `useInvalidateOnSuccess`.
- **QueryClient** (`src/config/queryClient.ts`): Shared singleton with `staleTime: 30_000` and `refetchOnWindowFocus: false` defaults.
- **Safe detection** (`src/lib/safe.ts`): Shared `isSafeApp` constant used by `useAutoConnect`, `useTokenAllowance`, `useStakingWrites`, `useDarkMode`.
- **Validator discovery** (`src/hooks/useValidators.ts`): Fetches validator data from `VITE_VALIDATOR_INFO_URL` or, by default, SEF's published `validator-info.json` (`SEF_DATA.validatorInfo` in `@cobuilders/safenet-core`). Returns `ValidatorInfo[]` with `{ address, isActive, label, commission, participationRate }`. Cached with React Query (5 min staleTime). Also exports `findValidator()` helper for synchronous address lookup.
- **Withdrawals** (`src/hooks/useWithdrawals.ts`): Fetches pending withdrawals for the connected user. Includes `useNextClaimable` for the claimable banner.
- **Gas estimation** (`src/hooks/useGasEstimate.ts`): Uses `estimateGas` + `getGasPrice` from viem to show estimated gas cost in delegate/undelegate dialogs. Debounced 500ms on amount change.
- **Rewards** (`src/hooks/useRewards.ts`, `src/hooks/useRewardProof.ts`, `src/hooks/useClaimRewards.ts`, `src/hooks/useProgrammeRewards.ts`): Rewards reading, Merkle proof fetching, claim transaction hooks, and the programme-wide figures (SEF's `latest.json`, the MerkleDrop's root and SAFE balance). Proofs are fetched from `${rewardsBaseUrl}/proofs/<radix>/{address}.json` and the current root/total from `${rewardsBaseUrl}/latest.json`, where `rewardsBaseUrl` is `VITE_REWARDS_BASE_URL` or, by default, SEF's published rewards data (`SEF_DATA.rewardsProofBase` in `@cobuilders/safenet-core`).
- **Subgraphs** (`src/config/subgraphs.ts`, `src/lib/subgraph.ts`, `src/hooks/useSubgraphQuery.ts`): Typed GraphQL through `graphql-request` and codegen. Documents live in `src/graphql/<chain>/*.graphql`; `pnpm codegen` writes `src/graphql/<chain>/generated.ts` from each subgraph package's `schema.graphql`, and `pnpm check` fails when the committed output is stale. Every query selects `_meta`, so each answer carries its last indexed block and age; an answer older than `SUBGRAPH_STALE_AFTER_SECONDS` (from core) is not shown as current. The overview hooks (`useNetworkTotals`, `useValidatorStakes`, `useRewardsOverview`, `useRecentDays`, `useConsensusFigures`) read the subgraph first and fall back to the contract reads, SEF's files, or the Gnosis snapshot in core. Each figure is a `Figure` (`src/lib/figure.ts`): loading, ready with its source, or unavailable with a reason.
- **Approval flow** (`src/hooks/useApprovalFlow.ts`): Wraps `useTokenAllowance` with approval type tracking (exact vs unlimited), toast notifications, and a unified API for DelegateDialog.
- **Stake form** (`src/hooks/useStakeForm.ts`): Amount, approval, stake and the approve-and-stake batch behind `StakeForm`. DelegateDialog and Claim & Stake both run on it. Batching is detected by `useAtomicBatchSupport` (`useStakingWrites.ts`), which accepts EIP-5792's `atomic.status: "supported"` and the earlier draft's `atomicBatch.supported`.
- **Claim step** (`src/hooks/useClaimStep.ts`): The claim inside Claim & Stake. Simulates first, sends through `wallet_sendCalls` in a wallet that batches, and reads the claimed amount from the SAFE `Transfer` in the receipt (`src/lib/claimReceipt.ts`).
- **Transaction toasts** (`src/hooks/useTxToast.ts`): Shared hook for success/error/Safe-queued toast notifications, used by DelegateDialog, UndelegateDialog, and other tx dialogs.

### Terminology

The UI uses "delegation" terminology externally (Delegate/Undelegate) but the smart contract uses "stake" terminology. Hook and contract function names reflect the contract (`useStake`, `stake()`), while component labels say "Delegate"/"Undelegate".

### Validator Metadata

Validator metadata (label, commission, participation rate) is fetched from the remote endpoint alongside address and active status — all fields live in the `ValidatorInfo` type returned by `useValidators()`. Components use `findValidator(validators, address)` for single-validator lookups. Unknown validators fall back to truncated address display.

### Compliance

- **IP-level sanctions** (`src/hooks/useSanctionsCheck.ts`): Fetches `VITE_SANCTIONS_API_URL` on mount; no-op if env var is unset.
- **Geo-blocking** (`src/hooks/useGeoblockCheck.ts`): Checks user's country via `api.country.is` against an OFAC/ITAR blocked country list. Result is cached in `localStorage` (key: `geoblock_check`) for `VITE_GEOBLOCK_CACHE_DAYS` days (default 7). Fails closed on lookup errors.
- **Wallet sanctions** (`src/hooks/useWalletSanctionsCheck.ts`): Checks connected wallet address against the sanctions API. Blocks the UI if flagged.

### UI Components

Radix UI primitives (`dialog`, `tabs`, `tooltip`, `slot`) wrapped in `src/components/ui/` using CVA + tailwind-merge (`cn()` from `src/lib/utils.ts`). These follow shadcn/ui conventions.

Key UI components:
- `button.tsx` — CVA button with variants (default, destructive, outline, secondary, ghost, link) and sizes
- `TxButton.tsx` — Transaction button with spinner and contextual labels during signing/confirming phases
- `card.tsx` — Compound card components (Card, CardHeader, CardTitle, CardContent)
- `dialog.tsx` — Radix Dialog with overlay animations
- `tabs.tsx` — Radix Tabs (used in staking section)
- `tooltip.tsx` — Radix Tooltip (used for FIFO queue info, etc.)
- `progress.tsx` — Progress bar with size (default, sm, lg) and variant (default, success, warning) props
- `stepper.tsx` — Horizontal step indicator with circles + connecting lines (used in ClaimAndStakeDialog for Claim → Stake → Done)
- `SafeTokenBadge.tsx` — SAFE token icon badge
- `ErrorBoundary.tsx` — React error boundary wrapping route elements
- `badge.tsx`, `input.tsx`, `skeleton.tsx` — Standard primitives

### Utility Libraries

- `src/lib/utils.ts` — `cn()` for class merging (clsx + tailwind-merge)
- `src/lib/format.ts` — `formatTokenAmount`, `truncateAddress`, `formatCountdown`
- `src/lib/errorFormat.ts` — `formatContractError` for user-friendly contract error messages, `revertedErrorName` for the custom error a revert carries
- `src/lib/clipboard.ts` — `copyToClipboard()` with navigator.clipboard API + textarea fallback

### Dashboard Components

- `StatsOverview` — Grid of stat cards (total delegated, user delegation, active validators, unstaking count, pending withdrawal total)
- `ClaimableBanner` — Dismissible banner when a withdrawal is ready to claim (uses `useNextClaimable`)
- `QuickActions` — Delegate/Undelegate/Claim navigation buttons (visible when connected)
- `ClaimRewardsDialog` — Dialog for claiming Merkle drop rewards (uses `TxButton`)
- `StakingSection` — Combined staking overview and calculator
- `StakeDistribution` — Recharts donut chart showing delegation distribution (only renders with 2+ validators)

### Validator Components

- `ValidatorList` — Grid of ValidatorCards. Accepts optional `autoOpenDelegate` prop for deep-linking. Batches `useReadContracts` for user stakes and passes data as props to cards.
- `ValidatorCard` — Per-validator card with metadata, stakes, delegate/undelegate buttons, copy address, and link to detail page. Receives `userStake`/`loadingUserStake` props; dialogs render conditionally only when open.

### Staking Components

- `AmountInput` — Input with 25%/50%/75%/MAX percentage shortcut buttons
- `DelegateDialog` — Stake dialog for one validator: `useStakeForm` rendered by `StakeForm`
- `StakeForm` — Amount, gas estimate, unstaking period, and the approve/stake buttons (batched in a wallet that supports it)
- `ValidatorSelect` — Picker over the active validators; chooses nothing for the user
- `UndelegateDialog` — Withdrawal initiation dialog with gas estimation, uses `useTxToast` and `TxButton`

### Rewards Components

- `ClaimAndStakeDialog` — Claim → Stake → Done. Stakes exactly what the claim paid; the user picks a validator and may lower the amount. A `MerkleRootWasUpdated` revert offers to reload the proof and retry. Closing after a claim says the SAFE is in the wallet, unstaked. Opened as "Stake your balance" once there is nothing left to claim.

### Withdrawal Components

- `WithdrawalQueue` — List of pending withdrawals with FIFO tooltip explanation
- `WithdrawalCard` — Per-withdrawal card with inline countdown timer, cooldown progress bar, and claim button

### Wallet Connection

Wagmi config (`src/config/wagmi.ts`) uses `safe()` (auto-detects Safe Wallet iframe), `injected()`, and optionally `walletConnect()` (if `VITE_WALLETCONNECT_PROJECT_ID` is set). Token approval flow is handled by `useApprovalFlow` hook (wraps `useTokenAllowance` with approval type tracking and toast notifications). ConnectButton supports copy-to-clipboard for the connected address.

### Path Alias

`@/*` maps to `./src/*` (configured in both `vite.config.ts` and `tsconfig.app.json`).

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_CHAIN_ID` | Yes | Target chain (1 = mainnet, 11155111 = sepolia) |
| `VITE_RPC_URL` | Yes | JSON-RPC endpoint |
| `VITE_STAKING_DEPLOY_BLOCK` | Yes | Block number to start scanning withdrawal events from |
| `VITE_VALIDATOR_INFO_URL` | No | Validator info JSON endpoint (defaults to SEF's published file, `SEF_DATA.validatorInfo` in `@cobuilders/safenet-core`) |
| `VITE_WALLETCONNECT_PROJECT_ID` | No | Enables WalletConnect connector |
| `VITE_MERKLE_DROP_ADDRESS` | No | Merkle drop contract address for rewards claiming |
| `VITE_SANCTIONS_API_URL` | No | Sanctions check endpoint (403 = blocked) |
| `VITE_REWARDS_BASE_URL` | No | Base URL for reward proof files (defaults to SEF's published rewards data, `SEF_DATA.rewardsProofBase` in `@cobuilders/safenet-core`) |
| `VITE_GEOBLOCK_CACHE_DAYS` | No | Geo-block cache duration in days (defaults to 7) |
| `VITE_DOCS_URL` | No | Footer documentation link (defaults to Safe docs) |
| `VITE_TERMS_URL` | No | Footer terms link (hidden if unset) |
| `VITE_PRIVACY_URL` | No | Footer privacy link (hidden if unset) |
| `VITE_IMPRINT_URL` | No | Footer imprint link (hidden if unset) |
| `VITE_SUBGRAPH_URL_MAINNET` | No | Mainnet subgraph query URL. Public in the bundle; never a URL with a key. Defaults to the Studio deployment named in `packages/core/src/subgraphs.ts`, in development and production builds alike. That is Studio's development URL, rate-limited to about 3,000 queries a day per subgraph, and not the production read path. Set it to the local graph-node's URL to read `pnpm graph:up` |
| `VITE_SUBGRAPH_URL_GNOSIS` | No | Gnosis subgraph query URL. Same rules |
| `VITE_APP_URL` | No | Canonical app URL for social preview meta tags (`og:image`, `twitter:image`); absolute URLs are required for social crawlers |

## Adding a New Chain

1. Add chain object to `chainMap` in `src/config/chains.ts`
2. Add contract addresses for the chain ID in `src/config/contracts.ts`
3. Update `.env` with the new `VITE_CHAIN_ID` and `VITE_RPC_URL`

## Merkle Proof Generation

Off-chain tooling for generating Merkle proofs compatible with the MerkleDrop contract.

### Scripts

- `scripts/merkle-tree.ts` — Pure Merkle tree logic (no I/O). Exports `encodeLeaf`, `buildMerkleTree`, `verifyProof`. Uses sorted-pair hashing (OpenZeppelin convention).
- `scripts/generate-merkle-tree.ts` — CLI entry point. Reads config, builds tree, writes output files.
- `scripts/merkle-config.json` — Input config with epoch number and address → cumulative amount mapping, plus optional `rewardsUntil` and `unpaidAmount`.
- `scripts/__tests__/merkle-tree.test.ts` — Unit tests for encoding, tree construction, and proof verification.
- `scripts/__tests__/generate-merkle-tree.test.ts` — Parses the generated `latest.json` with the app's own `parseRewardsLatest`.

### Workflow

1. Edit `scripts/merkle-config.json` with wallet addresses and cumulative amounts (in wei)
2. Run `pnpm generate:proofs`. It writes to `.rewards/`, which git ignores, or to the directory `--out <dir>` names
3. Output files, in the shape SEF publishes:
   - `proofs/<radix>/{lowercase_address}.json` — per-address proof file (`{ cumulativeAmount, merkleRoot, proof }`)
   - `latest.json` — `epoch`, `merkleRoot`, `rewardsUntil`, `tokenTotal`, `unpaidAmount`, `updatedAt`
4. Serve the output directory and point `VITE_REWARDS_BASE_URL` at it. `useRewardProof` fetches each proof from `${VITE_REWARDS_BASE_URL}/proofs/<radix>/{lowercase_address}.json`, and `useProgrammeRewards` reads `${VITE_REWARDS_BASE_URL}/latest.json`.
5. Only then set the Merkle root on-chain via the admin panel (see below). In the other order the app still serves the old proofs against the new root, and `useRewards` disables Claim because the roots differ.

### Config Format

```json
{
  "epoch": 1,
  "entries": {
    "0xAddress1": "1000000000000000000000",
    "0xAddress2": "500000000000000000000"
  },
  "rewardsUntil": "2026-09-22T00:00:00.000Z",
  "unpaidAmount": "0"
}
```

## Admin Panel

The `admin/` directory contains a separate Vite app for contract administration (proposing validators, recovering tokens, executing timelocked operations, and setting Merkle roots). It has its own `package.json` and runs independently.

### Admin Sections

- **Withdraw Delay** — Propose and execute withdraw delay changes (timelocked)
- **Validator Management** — Propose and execute validator registration/deregistration (timelocked)
- **Token Operations** — Mint test tokens, recover tokens from staking contract
- **Merkle Drop** — Set Merkle root on the MerkleDrop contract (only shown when `VITE_MERKLE_DROP_ADDRESS` is set)
- **Event Log** — View contract events

### Admin Contract Config

Admin contract addresses are in `admin/src/config/contracts.ts`. The `merkleDrop` field is optional and read from `VITE_MERKLE_DROP_ADDRESS`.

## Known Pre-existing Lint Errors

The following lint errors exist in the codebase and are not from recent changes:
- `admin/src/components/ProposeValidators.tsx` and `admin/src/components/RecoverTokens.tsx` — `react-hooks/set-state-in-effect` (setState in useEffect)
- `admin/src/components/ui/badge.tsx`, `admin/src/components/ui/button.tsx`, `admin/src/hooks/useToast.tsx` — `react-refresh/only-export-components`
- `src/components/ui/badge.tsx`, `src/components/ui/button.tsx`, `src/hooks/useToast.tsx` — `react-refresh/only-export-components`
