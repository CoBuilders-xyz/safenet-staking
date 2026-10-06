# Safe{Staking}

A web application for delegating SAFE tokens to validators on Ethereum. Built as a [Safe App](https://docs.safe.global/apps/overview) that runs natively inside Safe Wallet, with full support for EOA wallets via injected providers and WalletConnect.

## Features

- **Stake & Unstake** SAFE tokens to validators with a multi-step approval flow
- **Batch transactions** for Safe wallets — approve + stake in a single multisig proposal via [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792)
- **Withdrawal queue** with FIFO ordering, cooldown progress bars, and claim actions
- **Dashboard** with staking stats, rewards calculator, and stake distribution chart
- **Validator discovery** with delegate/undelegate actions per validator
- **Deep-linking** — open the stake dialog for a specific validator via `?delegate=0x...`
- **Dark mode** with system preference detection and manual toggle
- **Geo-blocking** and sanctions compliance checks
- **IPFS deployable** for censorship-resistant hosting

## Quick Start

```bash
pnpm install
pnpm --filter @cobuilders/safenet-web dev
```

The app will be available at `http://localhost:5173`, or on `WEB_PORT` from the repository-root
`.env.ports` when `pnpm bootstrap` has written one.

Vite reads env from the repository root, not from this directory: the root `.env`, and the root
`.env.local` that `pnpm env:pull` writes. Every value is optional. To set one by hand, copy it
from [`.env.example`](.env.example) into the root `.env`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_CHAIN_ID` | No | Target chain ID (defaults to Mainnet, from `@cobuilders/safenet-core`) |
| `VITE_RPC_URL` | No | JSON-RPC endpoint (defaults to the public list in `@cobuilders/safenet-core`) |
| `VITE_STAKING_DEPLOY_BLOCK` | No | Block number to start scanning validator events from (defaults to the scan floor in `@cobuilders/safenet-core`) |
| `VITE_WALLETCONNECT_PROJECT_ID` | No | Enables WalletConnect connector |
| `VITE_MERKLE_DROP_ADDRESS` | No | Merkle drop contract address for rewards claiming |
| `VITE_SANCTIONS_API_URL` | No | Sanctions check endpoint (HTTP 403 = blocked) |
| `VITE_GEOBLOCK_CACHE_DAYS` | No | Geo-block cache duration in days (defaults to 7) |
| `VITE_VALIDATOR_INFO_URL` | No | Validator info JSON endpoint (defaults to SEF's published file, `SEF_DATA.validatorInfo` in `@cobuilders/safenet-core`) |
| `VITE_REWARDS_BASE_URL` | No | Base URL for reward proof files (defaults to SEF's published rewards data, `SEF_DATA.rewardsProofBase` in `@cobuilders/safenet-core`) |
| `VITE_KYC_REQUIRED_URL` | No | KYC-required address list endpoint (defaults to GitHub raw URL) |
| `VITE_DOCS_URL` | No | Documentation link in footer (defaults to Safe docs) |
| `VITE_TERMS_URL` | No | Footer terms link (hidden if unset) |
| `VITE_PRIVACY_URL` | No | Footer privacy link (hidden if unset) |
| `VITE_IMPRINT_URL` | No | Footer imprint link (hidden if unset) |
| `VITE_APP_URL` | No | Canonical app URL for social preview meta tags (`og:image`, `twitter:image`); absolute URLs are required for social crawlers (no trailing slash) |
| `PINATA_JWT` | No | Pinata API JWT for IPFS deployment |
| `PINATA_GATEWAY` | No | Pinata gateway domain for IPFS deployment |

See [`.env.example`](.env.example) for a template.

## Scripts

| Command | Description |
|---------|-------------|
| `yarn dev` | Start development server |
| `yarn build` | Type-check and production build |
| `yarn lint` | Run ESLint |
| `yarn preview` | Preview production build locally |
| `yarn test` | Run unit/integration tests (vitest) |
| `yarn test:watch` | Run tests in watch mode |
| `yarn test:coverage` | Run tests with coverage report |
| `yarn test:e2e` | Run Playwright end-to-end tests |
| `pnpm test:fork` | Run the staking flows against real contracts on an Anvil Mainnet fork (see below) |
| `yarn deploy:ipfs` | Deploy build to IPFS via Pinata |
| `yarn generate:proofs` | Generate Merkle proofs for reward distribution |

See [`MANUAL_TESTING.md`](./MANUAL_TESTING.md) for the pre-release manual QA checklist
(covers scenarios not automated by the e2e suite, e.g. WalletConnect and Safe App flows).

## Fork suite

`pnpm test:e2e` mocks every RPC call. It proves the interface behaves, not that a transaction
works. `pnpm test:fork` drives the same interface against the real contracts: Anvil forks
Mainnet at a pinned block, the injected test wallet forwards every call to Anvil, and each test
reads the chain after the UI action to prove the transaction did what the screen says.

It covers approve then stake, initiating a withdrawal, claiming one after the cooldown (the
chain's clock is moved forward, and the page's clock with it), and claiming rewards with SEF's
real proof as an impersonated address. Each test runs inside an Anvil snapshot that is reverted
after it.

Run it locally:

```bash
pnpm env:pull     # once: writes MAINNET_RPC_URL to the root .env.local
pnpm test:fork    # from the root, or from apps/web
```

- **Needs** Foundry (`anvil` on the `PATH`) and `MAINNET_RPC_URL`, an archive endpoint, in the
  environment or the root `.env.local`. Public endpoints are not a fallback: they cannot serve
  state at a pinned block.
- **Ports** come from the root `.env.ports`: `ANVIL_PORT` for Anvil, `FORK_PORT` for the web
  server. Without the file, 8545 and 5178.
- **The pin** is `MAINNET_FORK` in `packages/core/src/fork.ts`: a block and the commit of SEF's
  data repository from the same moment. Move them together, or the reward proofs stop matching
  the root on chain.
- **Anvil** starts and stops with the run, pass or fail. Its output is shown with URLs redacted.
- **The fork URL is on Anvil's command line**, because Anvil 1.8.4 reads it from no environment
  variable. On a shared machine, anyone who can list processes can read the URL, key included,
  while the suite runs. On a CI runner this does not matter.

It runs nightly in CI, not on pull requests, because every run reads from the archive node.

## Tech Stack

- **React 19** with TypeScript
- **Vite 7** with Tailwind CSS 4
- **wagmi 3** / **viem** for wallet and contract interactions
- **React Router 7** with hash-based routing (for IPFS compatibility)
- **Radix UI** primitives (dialog, tabs, tooltip) styled with [shadcn/ui](https://ui.shadcn.com/) conventions
- **Recharts** for data visualization
- **Vitest** for unit/integration tests
- **Playwright** for end-to-end testing

## Architecture

```
src/
├── abi/            # Contract ABIs (parseAbi with human-readable signatures)
├── components/
│   ├── dashboard/  # Stats, rewards, staking section
│   ├── layout/     # Header, footer, shared layout
│   ├── staking/    # DelegateDialog, UndelegateDialog, AmountInput
│   ├── ui/         # Radix + CVA primitives (button, card, dialog, etc.)
│   ├── validators/ # ValidatorCard, ValidatorList
│   ├── wallet/     # ConnectButton
│   └── withdrawals/# WithdrawalQueue, WithdrawalCard, CountdownTimer
├── config/         # Chain, contract addresses, wagmi config
├── data/           # Static validator metadata (JSON)
├── hooks/          # Contract reads, writes, gas estimation, rewards
├── lib/            # Utilities (formatting, error handling, clipboard)
└── pages/          # Route components
e2e/                # Playwright suites: tests/ against mocked RPC, fork/ against an Anvil Mainnet fork
scripts/            # Off-chain tooling (Merkle proof generation)
admin/              # Admin panel (validator proposals, contract management)
```

### Routes

| Path | Page | Description |
|------|------|-------------|
| `/` | `DashboardPage` | Stats, rewards, staking section, stake distribution chart |
| `/validators` | `ValidatorsPage` | Validator discovery and delegate/undelegate actions |
| `/validators/:address` | `ValidatorDetailPage` | Individual validator info and actions |
| `/withdrawals` | `WithdrawalsPage` | Pending withdrawals queue and claims |
| `*` | `NotFoundPage` | 404 catch-all |

### Wallet Support

The app connects via three wagmi connectors, resolved in order:

1. **Safe** — auto-detected when running inside the Safe Wallet iframe
2. **Injected** — MetaMask, Rabby, and other browser extension wallets
3. **WalletConnect** — enabled when `VITE_WALLETCONNECT_PROJECT_ID` is set

When connected through Safe, the app detects [EIP-5792](https://eips.ethereum.org/EIPS/eip-5792) `atomicBatch` capability and batches approve + stake into a single transaction proposal, reducing multisig signing rounds from 2 to 1.

### Contract Integration

The UI uses "delegation" terminology (Delegate/Undelegate) but the smart contract uses "stake" terminology internally. Write hooks wrap `stake()`, `initiateWithdrawal()`, and `claimWithdrawal()` contract functions.

- **Read hooks** (`useStakingReads.ts`) poll every 15 seconds via `refetchInterval`
- **Write hooks** (`useStakingWrites.ts`) return a unified `{ action, isSigningTx, isConfirmingTx, isSuccess, error, reset, txHash }` interface
- **Validator discovery** fetches `ValidatorUpdated` events from the deploy block with automatic chunked fallback for RPC block-range limits
- **Rewards** — Merkle-proof-based reward claiming via a MerkleDrop contract. Proofs are generated off-chain (see below) and served as static JSON files

### Merkle Proof Generation

The `scripts/` directory contains tooling for generating Merkle proofs compatible with the MerkleDrop contract:

1. Edit `scripts/merkle-config.json` with wallet addresses and cumulative reward amounts (in wei):
   ```json
   {
     "epoch": 1,
     "entries": {
       "0xWalletAddress": "1000000000000000000000"
     }
   }
   ```
   Two optional fields complete `latest.json`: `rewardsUntil` (ISO 8601, defaults to the time
   of the run) and `unpaidAmount` (wei, defaults to `"0"`).
2. Run `pnpm generate:proofs`. It writes to `.rewards/`, which git ignores; `--out <dir>` names
   another directory.
3. Output, in the shape SEF publishes:
   - `proofs/<radix>/{lowercase_address}.json` — per-address proof files
   - `latest.json` — `epoch`, `merkleRoot`, `rewardsUntil`, `tokenTotal`, `unpaidAmount`, `updatedAt`
4. Serve the output directory and point `VITE_REWARDS_BASE_URL` at it. `useRewardProof` fetches each proof from `${VITE_REWARDS_BASE_URL}/proofs/<radix>/{lowercase_address}.json`, and `useProgrammeRewards` reads `${VITE_REWARDS_BASE_URL}/latest.json`.
5. Only then set the Merkle root on-chain via the admin panel. In the other order the app still serves the old proofs against the new root, and `useRewards` disables Claim because the roots differ.

The tree uses sorted-pair hashing (OpenZeppelin convention) and viem for encoding.

### Adding a New Chain

1. Add the chain object to `chainMap` in `src/config/chains.ts`
2. Add contract addresses for the chain ID in `src/config/contracts.ts`
3. Set `VITE_CHAIN_ID` and `VITE_RPC_URL` in your environment

## Admin Panel

The `admin/` directory is a separate Vite app for contract administration. Run it independently with `cd admin && yarn dev`.

**Sections:**
- **Withdraw Delay** — Propose and execute delay changes (timelocked)
- **Validator Management** — Propose and execute validator registration/deregistration (timelocked)
- **Token Operations** — Mint test tokens, recover tokens from the staking contract
- **Merkle Drop** — Set the Merkle root on the MerkleDrop contract (shown when `VITE_MERKLE_DROP_ADDRESS` is set)
- **Event Log** — View contract events

## Deployment

### IPFS

```bash
yarn build
yarn deploy:ipfs
```

Requires `PINATA_JWT` and `PINATA_GATEWAY` environment variables. The build uses hash-based routing (`HashRouter`) for compatibility with IPFS gateways. Set `VITE_APP_URL` to the canonical URL so that `og:image` and `twitter:image` meta tags resolve correctly for social crawlers.

### Safe App

The app includes a `/manifest.json` for Safe App discovery. To run inside Safe Wallet:

1. Deploy to any static host (Vercel, IPFS, etc.)
2. In Safe Wallet, go to Apps > Add Custom App
3. Enter the deployment URL

## License

MIT — see [LICENSE](LICENSE) for details.
