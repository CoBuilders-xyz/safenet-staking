# Manual testing

A pre-release checklist for the Safenet staking interface. It covers what the automated suites
do not: a real wallet extension, WalletConnect, the Safe App, and a look at every screen.

What is automated already:

- `pnpm --filter @cobuilders/safenet-web test:e2e` drives every screen with an injected test
  wallet against a mocked RPC. The Safe App and WalletConnect are only smoke-tested there: inside
  an iframe the Connect and Disconnect buttons are hidden and public data still renders, and
  WalletConnect appears in the connector menu.
- `pnpm --filter @cobuilders/safenet-web test:fork` sends approve and stake, a withdrawal, a
  withdrawal claim and a reward claim to the real contracts on an Anvil Mainnet fork.
- The compliance hooks, `useGeoblockCheck`, `useSanctionsCheck` and `useWalletSanctionsCheck`,
  have unit tests in `src/hooks/__tests__/`.

## Where to test

The interface targets Ethereum Mainnet only. There is no testnet deployment.

- **The manual QA fork**, for anything that sends a transaction. `pnpm fork:up` at the
  repository root starts Anvil on a fork of Mainnet, gives a test account SAFE and a reward to
  claim, and serves the interface for a browser and MetaMask. `pnpm fork:reset` returns to the
  start; `pnpm fork:down` stops it. It needs Foundry and the archive `MAINNET_RPC_URL`. The guide,
  with the MetaMask setup and the Claim & Stake walk-through, is
  [`docs/manual-qa-fork.md`](../../docs/manual-qa-fork.md).
- **A Mainnet build**, for read-only checks, WalletConnect pairing and the Safe App. Any
  transaction there spends real SAFE and ETH.

The connection modes:

- **Browser Wallet**: MetaMask or another extension.
- **WalletConnect**: needs `VITE_WALLETCONNECT_PROJECT_ID` in the build. Connect Wallet, then
  WalletConnect, then pair a mobile wallet.
- **Safe App**: see [Safe App](#safe-app).

Note the transaction hash of everything you send, for debugging later.

## No wallet connected

- [ ] Network Overview (`/`) renders every section: Data freshness, Headline figures, Stake
      distribution, Rewards, Validators, Recent activity.
- [ ] Each figure names its source, and Data freshness gives each subgraph's last indexed block
      and age.
- [ ] Dashboard (`/dashboard`) shows the total delegated; quick actions are hidden.
- [ ] Validators (`/validators`) lists the validator cards with name, participation rate and
      total stake, and states SEF's 75% participation rule as text.
- [ ] A validator's detail page (`/validators/<address>`) shows its figures; an unknown address
      shows not found.
- [ ] Withdrawals (`/withdrawals`) asks to connect.
- [ ] Rewards (`/rewards`) explains that a wallet is needed and still shows Programme and
      Verifiability.
- [ ] No button anywhere sends a transaction.
- [ ] An unknown path shows the 404 page with a link back to the overview.
- [ ] The theme toggle switches light and dark and survives a reload.

## Per connection mode

On the manual QA fork for Browser Wallet. On a Mainnet build for WalletConnect and the Safe App,
with an account you are willing to transact from.

| # | Scenario | Browser Wallet | WalletConnect | Safe App |
|---|---|---|---|---|
| 1 | The header shows the account and its SAFE balance | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 2 | Dashboard: your stats and the quick actions appear | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 3 | Delegate from a validator card: approve, then stake; Your Stake updates | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 4 | Undelegate: the withdrawal appears in the queue with its cooldown | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 5 | Withdrawals: Claim after the cooldown empties that entry | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 6 | Validator detail: your delegation to that validator is shown | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 7 | Rewards: Claim pays the available amount, and Your rewards and Programme update | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 8 | Rewards: Claim & Stake runs Claim → Stake → Done, staking what the claim paid | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 9 | Rewards: an address without rewards says so, with no Claim | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |

On the fork, a withdrawal's cooldown does not pass by itself, so row 5 needs a withdrawal that is
already claimable, or Anvil's clock moved forward. The fork suite covers this case against the
real contracts.

Notes and transaction hashes:

```
(free-form notes per release)
```

## Staking details

- [ ] `?delegate=<address>` on `/validators` opens the delegate dialog for that validator.
- [ ] The 25%, 50%, 75% and MAX shortcuts fill the amount; Delegate stays disabled without one.
- [ ] The dialog shows a gas estimate and the unstaking period.
- [ ] With an allowance below the amount, both Approve exact amount and Approve unlimited unlock
      Stake, each on a separate run.
- [ ] Rejecting the wallet prompt shows an error and leaves the dialog usable.
- [ ] A validator SEF lists as inactive reads Withdrawn, keeps its figures, and cannot be staked
      with.
- [ ] With two or more pending withdrawals, only the oldest has Claim; claiming it reveals the
      next.

## Claim & Stake

Follow the walk-through and the abandon path in
[`docs/manual-qa-fork.md`](../../docs/manual-qa-fork.md). Also:

- [ ] Lowering the amount on the Stake step stakes less and leaves the rest in the wallet.
- [ ] With an allowance that already covers the amount, the Stake step skips approval.
- [ ] After a claim, closing the dialog warns that the SAFE is in the wallet and not staked.
- [ ] Once nothing is left to claim, the action reads Stake your balance.
- [ ] Verifiability names the MerkleDrop contract, the source of `latest.json`, and whether the
      root on chain matches SEF's published root.

## Restricted and wrong-network states

- [ ] **Wrong network**, Browser Wallet and WalletConnect: connect on another chain, or switch
      chains during the session. The header shows "Switch to Ethereum", the actions are blocked,
      and Rewards says why Claim is unavailable. Switching back restores them.
- [ ] **Access Restricted**, the country check: block requests to the two country lookup
      services named in `src/hooks/useGeoblockCheck.ts` in the browser's developer tools, clear
      the `geoblock_check` key in `localStorage`, and reload. The check fails closed, so the app
      shows Access Restricted. Remove the block and the key, and reload: the app returns.
- [ ] **Access Restricted**, the sanctions endpoint, only for a build with
      `VITE_SANCTIONS_API_URL`: the app opens when the endpoint allows the visitor. A 403 or a
      failed request shows Access Restricted.
- [ ] **Wallet Restricted** needs an address the sanctions oracle in `packages/core` lists, so it
      is left to the unit tests. A connected test address must not see it.

## Safe App

The Safe App entry point, the URL to add in Safe{Wallet}, is published with each release. A
local `pnpm --filter @cobuilders/safenet-web dev` or `preview` server is configured to be framed
by Safe{Wallet} as well: `vite.config.ts` sends the CORS, private-network and `frame-ancestors`
headers for it.

- [ ] In Safe{Wallet}, on Ethereum, add the entry point as a custom Safe App. Safe{Wallet} reads
      the manifest and shows the name, description and icon in `apps/web/public/manifest.json`.
- [ ] Open the app from the Safe. It connects through the Safe connector by itself: no Connect
      Wallet button, no connector menu, and the header shows the Safe's address.
- [ ] Public data renders inside the iframe, as outside it.
- [ ] Delegate with an allowance below the amount. A Safe that supports atomic batching proposes
      approve and stake as one transaction.
- [ ] With a threshold of two or more, a submitted transaction shows a toast that it was sent to
      Safe{Wallet} for signing, not a success. After the other owners confirm and it executes, a
      reload shows the new state.
- [ ] Claim & Stake inside a Safe: when the claim is queued, the dialog says so and tells the
      user to come back to Stake your balance once it executes.
- [ ] With two or more withdrawals ready, Withdrawals offers Claim All.
