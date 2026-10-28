# CLAUDE.md — apps/web

Guidance for agents working in `@cobuilders/safenet-web`, the Safenet staking interface. Read the
root `CLAUDE.md` first: its rules on constants and secrets apply here. `README.md` in this
directory covers setup, the environment variables and the test suites for a human reader.

## Commands

Run every script as `pnpm --filter @cobuilders/safenet-web <script>` from the repository root, or
as `pnpm <script>` from `apps/web`.

- **Dev server:** `dev`. Vite reads env from the repository root, not from this directory.
- **Build:** `build` (`tsc -b && vite build`)
- **Check:** `check`: `codegen:check`, which fails if `src/graphql/<chain>/generated.ts` is stale,
  then ESLint, `tsc -b --noEmit` and the e2e TypeScript project. The root `pnpm check` runs it.
- **Lint only:** `lint`
- **Unit tests:** `test` (Vitest, `src/**` and `scripts/**`); `test:watch`; `test:coverage`
- **E2E, mocked RPC:** `test:e2e` (Playwright, `e2e/tests/`); `test:e2e:ui`; `test:e2e:headed`.
  Needs Chromium once: `pnpm --filter @cobuilders/safenet-web exec playwright install chromium`,
  which `pnpm bootstrap` also runs.
- **E2E, Anvil fork:** `test:fork` (Playwright, `e2e/fork/`). Needs `anvil` and the archive
  `MAINNET_RPC_URL`.
- **GraphQL types:** `codegen` regenerates them; `codegen:live-check` validates the documents
  against a running graph-node
- **Reward proofs:** `generate:proofs [--out <dir>]` reads `scripts/merkle-config.json` and writes
  to the git-ignored `.rewards/` by default
- **Manual QA fork:** `fork:up`, `fork:reset`, `fork:down`, also from the repository root as
  `pnpm fork:up` and so on. The tool is `scripts/fork-env/`; the guide is
  `docs/manual-qa-fork.md` at the repository root
- **Performance budget:** `budget:bundle` checks a built `dist/` against the bundle limits in
  `performance-budget.json`, and `release:build` runs it; `budget:lighthouse` serves `dist/` on
  loopback and checks Lighthouse mobile, the median of three runs per route, against the rest.
  `PERFORMANCE.md` explains each limit. Raise one only with the measurement that justifies it.
- **IPFS release:** `release:build` builds from `build.env` alone, checks the bundle budget, and
  writes `release/app.car` and `release/CID`; `release:pin` pins the CAR to Pinata and checks the
  gateways, with `PINATA_JWT` and `PINATA_GATEWAY`. `VERIFY.md` at the root rebuilds a release;
  `.github/workflows/release.yml` runs both on a `v*` tag or by hand

Before every commit, run `pnpm check` from the root. Before a pull request, also `test`,
`test:e2e` and `build` here.

## Constants

Every address, chain id, start block, RPC list, subgraph endpoint and SEF data URL comes from
`@cobuilders/safenet-core`. Do not write one in this package. Environment variables may override
some of them, and the e2e suite relies on that to point the app at mocks.

- `src/config/chains.ts`: the wagmi chain is Mainnet, the only chain core configures. RPC
  endpoints are `VITE_RPC_URL` and its two fallbacks when set, which replace core's list,
  otherwise core's list. `VITE_CHAIN_ID` selects only the default RPC list and the scan floor.
- `src/config/contracts.ts`: `getContractAddresses()` returns core's Mainnet addresses for the
  staking contract, the SAFE token, the MerkleDrop (`VITE_MERKLE_DROP_ADDRESS` overrides it) and
  the sanctions oracle. `deployBlock` is `VITE_STAKING_DEPLOY_BLOCK` or core's scan floor.
- `src/config/subgraphs.ts`: `VITE_SUBGRAPH_URL_MAINNET` and `VITE_SUBGRAPH_URL_GNOSIS` when set,
  otherwise the defaults in `packages/core/src/subgraphs.ts`, which are Studio deployments.

Every `VITE_` value is public in the bundle. Never give a secret a `VITE_` name.

## Architecture

React 19 and TypeScript, Vite 7, Tailwind CSS 4 (through `@tailwindcss/vite`), wagmi 3 and viem,
TanStack Query, Radix UI, graphql-request and Recharts.

### Provider stack (`src/main.tsx`)

`initI18n()` loads the selected catalogue before rendering. Then `StrictMode` → `WagmiProvider` (`reconnectOnMount={false}`) → `QueryClientProvider` →
`ToastProvider` → `App`

`RouteContent` preloads alongside the first page while access checks run; `Layout` renders it after they pass. It wraps the route outlet in
`TooltipProvider`, keeping tooltip positioning code out of the initial entry bundle.

### Languages (`src/i18n/`)

i18next with react-i18next, one namespace. `languages.ts` lists the eight languages and detects
the starting one: the choice stored under `localStorage` `language`, else the browser's
preferred languages, else English. `index.ts` puts English in the main bundle and loads every
other catalogue on demand through `import.meta.glob`; the document's `lang` follows
`currentLanguage()`, which is English when a catalogue failed to load. `LanguageSwitcher` in the
header stores a choice; a detected language is never stored.

Each call carries its key and English: `t("overview.hero.title", "Network overview")`. Keys are
string literals, or `i18n:check` fails; `scripts/i18n-catalogues.ts` has the rules. Plurals take
`count`. Numbers and dates are formatted before they reach `t`, with the same formatters in every
language. A function outside a component takes `t` as a parameter (`describeDegradation`,
`formatAge`, the `*Messages(t)` helpers in the overview hooks).

The catalogues cover every route and the wallet/transaction dialogs. The check also rejects
raw JSX copy and literal user-facing attributes, even in files that do not import i18n.
`lib/programme.ts` retains reference English constants; a test in `src/i18n/__tests__/`
holds those constants equal to the `programme.*` keys. Render the translated keys in UI code.

### Routing (`src/App.tsx`)

`HashRouter`. Seven routes under a shared `Layout` (header, footer, `<Outlet />`), each page
wrapped in `ErrorBoundary`:

- `/` → `OverviewPage`: Network Overview, no wallet needed. Headline figures, stake distribution,
  rewards with the root check, the validator table, the last 30 days, and a freshness line per
  subgraph
- `/dashboard` → `DashboardPage`: stats, claimable banners, quick actions, the staking section,
  the stake distribution chart
- `/validators` → `ValidatorsPage`: validator cards with Delegate and Undelegate.
  `?delegate=<address>` opens the delegate dialog
- `/validators/:address` → `ValidatorDetailPage`
- `/withdrawals` → `WithdrawalsPage`: the queue, oldest first, cooldowns, Claim, and Claim All in
  a batching wallet
- `/rewards` → `RewardsPage`: Your rewards, Claim, Claim & Stake, Programme, and Verifiability,
  the on-chain root checked against SEF's published one
- `*` → `NotFoundPage`

Pages are lazy-loaded with `React.lazy()` from `src/routes.ts`. The page of the URL opened starts
loading at once, alongside the gates (`routeImportFor`); the others preload after the `load`
event, when the browser is idle.

App-level gates, each rendering `RestrictedScreen` with a `Restriction` (`src/lib/restriction.ts`):
the gate, and whether it refused or could not answer. Each hook returns `allowed`, `isLoading` and
`restriction`; `App.tsx` blocks on `!allowed` alone, so a block without a reason still blocks, as
a failed check. `chooseRestriction` picks the one to name: a refusal before a failed check, then
the sanctions screening before the location check.

- `useGeoblockCheck` looks up the country (country.is, then ipapi.co) and blocks the countries
  listed in the hook, naming the country. It fails closed: a failed lookup is "unavailable". The
  result is cached in `localStorage` for `VITE_GEOBLOCK_CACHE_DAYS` days, 7 by default.
- `useSanctionsCheck` fetches `VITE_SANCTIONS_API_URL` when set; a 403 refuses, an error is
  "unavailable".
- `WalletSanctionsGate` uses `useWalletSanctionsCheck`, which reads `isSanctioned` on the
  sanctions oracle from core for the connected address. It allows only an explicit `false`; `true`
  refuses and anything else is "unavailable", with `refetch` behind Try again.

`DisconnectWatcher` shows a toast when the wallet disconnects.

### Wallets (`src/config/wagmi.ts`)

Connectors in order: `safe()`, `injected()` as "Browser Wallet" on `window.ethereum`, and
WalletConnect when `VITE_WALLETCONNECT_PROJECT_ID` is set, through `deferredWalletConnect`
(`src/config/walletConnect.ts`): wagmi's connector, loaded only once the user picks it or it was
the last connector used. Created plainly, it loaded about 300 KB on every first paint. `src/lib/safe.ts` exports
`isSafeApp`, true inside an iframe. `useAutoConnect` connects the Safe connector when
`isSafeApp`, and calls wagmi's `reconnect()` otherwise. `useWrongNetwork` is true when the
wallet's chain is not Mainnet. `useNetworkSwitch` adds whether the connector can switch (the Safe
connector cannot) and the switch itself. `WrongNetworkNotice`, in `Layout`, then shows on every
page, and `ConnectButton` shows "Switch to Ethereum", or "Wrong network" when the wallet cannot
switch. Reads do not go through the wallet, so figures stay correct; `TxButton` disables every
transaction.

### Contract integration

- **ABIs:** every ABI is imported from `@cobuilders/safenet-core` (`stakingAbi`, `erc20Abi`,
  `sanctionsOracleAbi`, `merkleDropAbi`, `safeTokenEventsAbi`), and events through
  `indexedEvent()`. `verify:abis` proves each function, event and error against the chain. No
  ABI or signature is written in this package; a function the interface needs is added to core.
- **Reads** (`src/hooks/useStakingReads.ts`): wrappers around `useReadContract` and
  `useReadContracts`, polling every 30 seconds. Per-user hooks are enabled only with an address.
- **Writes** (`src/hooks/useStakingWrites.ts`): `useStake`, `useInitiateWithdrawal`,
  `useClaimWithdrawal` and the batch hooks combine `useWriteContract` with
  `useWaitForTransactionReceipt` and return `isSigningTx`, `isConfirmingTx`, `isSuccess`,
  `isSafeQueued`, `error`, `reset` and `txHash` next to the action. `useInvalidateOnSuccess`
  invalidates the affected queries. `useAtomicBatchSupport` accepts EIP-5792's
  `atomic.status: "supported"` and the earlier draft's `atomicBatch.supported`.
- **QueryClient** (`src/config/queryClient.ts`): `staleTime: 30_000`,
  `refetchOnWindowFocus: false`.
- **Validators** (`src/hooks/useValidators.ts`): fetches `VITE_VALIDATOR_INFO_URL` or SEF's
  `validator-info.json` (`SEF_DATA.validatorInfo` in core), cached five minutes. `findValidator()`
  looks one up by address; an unknown address shows truncated. `participationRate` is null when
  SEF publishes no rate, never 0.
- **Withdrawals** (`src/hooks/useWithdrawals.ts`): the connected user's queue, polled every
  15 seconds, and `useNextClaimable` for the banner.
- **Gas** (`src/hooks/useGasEstimate.ts`): `estimateGas` and `getGasPrice`, debounced 500 ms.
- **Approval** (`src/hooks/useApprovalFlow.ts`): wraps `useTokenAllowance` with the exact or
  unlimited approval type and its toasts.
- **Stake form** (`src/hooks/useStakeForm.ts`): amount, approval, stake and the approve-and-stake
  batch behind `StakeForm`. `DelegateDialog` and Claim & Stake both run on it. Stake opens the
  "what happens if" step, `StakeReview`; only its Confirm stake sends the stake or the batch. An amount the
  interface fills in, the claimed amount or a MAX or percentage shortcut, is a `PresetAmount`
  (`src/lib/format.ts`): shown rounded down to four decimals and sent exact while its text is
  unchanged.
- **Claim step** (`src/hooks/useClaimStep.ts`): the claim inside Claim & Stake. Simulates first,
  sends through `wallet_sendCalls` in a batching wallet, and reads the claimed amount from the
  SAFE `Transfer` in the receipt (`src/lib/claimReceipt.ts`).
- **Toasts** (`src/hooks/useTxToast.ts`): success, error and Safe-queued toasts for the
  transaction dialogs.

### Rewards

`useRewards`, `useRewardProof`, `useClaimRewards` and `useProgrammeRewards` read the reward state,
fetch the proof, claim, and read the programme-wide figures (SEF's `latest.json`, the
MerkleDrop's root and SAFE balance). Both files are read through `src/hooks/useRewardsSource.ts`:

1. `VITE_REWARDS_BASE_URL` when set, which replaces every other source.
2. SEF's IPFS dataset behind the ENS name in core, through each gateway, when its contenthash is
   set: `VITE_IPFS_GATEWAY` first, then core's list.
3. The repository mirror.

The order, the gateways, the timeouts and the paths come from `src/rewards-source.ts` and
`src/sef.ts` in core. The ENS resolution is one TanStack query, `["rewardsSource"]`, kept for an
hour through `gcTime`. A proof is absent only when the repository, or the override, answers 404;
when the dataset did not answer, Your rewards says the absence rests on the mirror
(`proofAbsenceCaveat` in `src/lib/rewardsSource.ts`). `useProgrammeRewards` returns
`latestSource`, which Verifiability shows as the source of `latest.json`.

SEF's `latest.json` carries exactly `epoch`, `merkleRoot`, `rewardsUntil`, `tokenTotal` and
`unpaidAmount`.

`useRewards` disables Claim when the proof's root differs from the MerkleDrop's root.

### Subgraphs

`src/config/subgraphs.ts`, `src/lib/subgraph.ts`, `src/hooks/useSubgraphQuery.ts`. Typed GraphQL
through `graphql-request` and codegen. Documents live in `src/graphql/<chain>/*.graphql`;
`codegen` writes `src/graphql/<chain>/generated.ts` from each subgraph package's
`schema.graphql`, through the served schema `scripts/subgraph-api-schema.ts` derives. Every query
selects `_meta`, so each answer carries its last indexed block and age; an answer older than
`SUBGRAPH_STALE_AFTER_SECONDS` from core is not shown as current. The overview hooks
(`useNetworkTotals`, `useValidatorStakes`, `useRewardsOverview`, `useRecentDays`,
`useConsensusFigures`) read the subgraph first and fall back to contract reads, SEF's files, or
the Gnosis snapshot in core. Each figure is a `Figure` (`src/lib/figure.ts`): loading, ready
with its source, or unavailable with a reason.

The Gnosis Overview reads only Aegis rows and programme membership. A known member with no
attendance rows has zero attendance and all window ceremonies as absences. Complete calendar
days without a bucket count as zero in the daily average. The window ends at the latest stored
complete day and spans at most 14 days. Aegis coverage starts at core's verified first complete
day after deployment, retaining its first attestation day and earlier silent days. Beta excludes
its first stored day because its index starts part way through history. Missing or incomplete
membership never invents a participation rate. When the subgraph fails, the dated Beta snapshot
remains visibly labelled as historical data.

### Terminology

The interface says Delegate and Undelegate. The contract says stake, and so do the hooks
(`useStake`, `stake()`, `initiateWithdrawal()`, `claimWithdrawal()`).

### Components

- `src/components/ui/`: Radix primitives wrapped with CVA and tailwind-merge (`cn()` in
  `src/lib/utils.ts`), after shadcn/ui. `Term` explains a term where it appears, from
  `src/lib/glossary.ts`: a button that opens on hover, focus or a tap, and closes on Escape. `TxButton` shows the signing and confirming phases;
  `stepper.tsx` drives Claim → Stake → Done.
- `src/components/overview/`: the Network Overview sections.
- `src/components/dashboard/`: `StatsOverview`, `QuickActions`, `StakingSection`,
  `StakeDistribution`, `ClaimRewardsDialog`.
- `src/components/rewards/`: the Rewards page sections and `ClaimAndStakeDialog`. Its stake amount
  starts at what the claim paid and cannot exceed it; the user picks a validator and may lower
  the amount, and the rest stays in the wallet. A
  `MerkleRootWasUpdated` revert offers to reload the proof and retry. Once nothing is left to
  claim, it opens as "Stake your balance".
- `src/components/validators/`: `ValidatorList`, `ValidatorCard`, and `ParticipationRate`, which
  marks SEF's 75% reward threshold. Screens that show a rate also state the rule as text, because
  a tooltip does not open on touch. `PublishedParticipationRate`, in the same file, takes SEF's
  rate in percent: a null reads "Not published", with no marker, never 0.00%. The validator
  cards, the detail page and the dashboard positions use it; the Overview table says "Not
  published" for a row SEF lists with a null rate.
- `src/components/staking/`: `AmountInput`, `DelegateDialog`, `StakeForm`, `StakeReview`,
  `ValidatorSelect`, `UndelegateDialog`.
- `src/components/withdrawals/`: `WithdrawalQueue`, `WithdrawalCard`.

### Libraries

- `src/lib/format.ts`: token amounts, preset amounts, addresses, countdowns, participation rates,
  UTC dates.
- `src/lib/restriction.ts`: the gates' `Restriction` and the restricted screen's copy.
- `src/lib/glossary.ts`: what each term means, restating SEF's staking documentation. Figures come
  from core or the staking contract, never from the text.
- `src/lib/programme.ts`: copy built on the programme calendar in core: `PARTICIPATION_RULE`,
  `RATE_NOT_PUBLISHED` for a rate SEF lists as null, `belowThreshold`, the dated Beta notice, the withdrawn status for a validator SEF lists as
  inactive.
- `src/lib/errorFormat.ts`: `formatContractError`, `revertedErrorName`.
- `src/lib/clipboard.ts`: `copyToClipboard()`.

### Path alias

`@/*` maps to `./src/*`, in `vite.config.ts` and `tsconfig.app.json`.

## Scripts directory

- `scripts/merkle-tree.ts`: Merkle tree logic, no I/O. `encodeLeaf`, `buildMerkleTree`,
  `verifyProof`, sorted-pair hashing (OpenZeppelin convention).
- `scripts/generate-merkle-tree.ts`: `generate:proofs`. Reads `scripts/merkle-config.json`
  (`epoch`, `entries` of address to cumulative wei, optional `rewardsUntil` and `unpaidAmount`)
  and writes `proofs/<radix>/<lowercase address>.json` (`{ cumulativeAmount, merkleRoot, proof }`)
  and `latest.json`.
- `scripts/fork-env/`: the manual QA fork. Anvil on a pinned Mainnet fork, a rewards tree of every
  real claimer plus a test account, the new root set as the MerkleDrop's owner
  (`chain.ts`), and a proxy that serves the app, the proofs and the RPC on one origin. Uses
  `merkle-tree.ts`.
- `scripts/codegen-check.ts`, `scripts/codegen-live-check.ts`, `scripts/subgraph-api-schema.ts`:
  GraphQL codegen and its checks.
- `scripts/release.ts`, `scripts/release-pin.ts`, `scripts/release-gateways.ts`: the IPFS
  release behind `release:build` and `release:pin`. `build.env` is the release build's only env
  input; it is public and holds no secret.
- `scripts/__tests__/`: Vitest tests for the tree and the generator.

To use generated proofs, serve the output and point `VITE_REWARDS_BASE_URL` at it, then set the
MerkleDrop's root. This repository sets a root only on an Anvil fork.

## Tests

- `src/**/__tests__/`: Vitest with jsdom. `src/__tests__/` holds the wagmi mock, the setup and
  shared test data.
- `e2e/tests/accessibility.spec.ts`: axe, WCAG 2.2 A and AA, on every route and state; a serious
  or critical violation fails it. `ACCESSIBILITY.md` says what it covers and what a person checks.
- `e2e/tests/`: Playwright against a mocked RPC, mocked subgraphs, mocked SEF files and mocked
  gateways (`e2e/mocks/`, `e2e/fixtures/`). Page objects in `e2e/pages/`. The Safe App and
  WalletConnect are only smoke-tested.
- `e2e/fork/`: Playwright against Anvil. `e2e/playwright.config.ts` switches suites on
  `E2E_SUITE=fork`, which `test:fork` sets.

Ports come from `.env.ports` at the repository root: `E2E_PORT`, `FORK_PORT`, `ANVIL_PORT`
(`e2e/ports.ts`). Without the file, 5174, 5178 and 8545.
