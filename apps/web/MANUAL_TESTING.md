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
  have unit tests in `src/hooks/__tests__/`. `e2e/tests/restricted.spec.ts` drives each gate's
  refusal and failed check in the browser, and `e2e/tests/wrong-network.spec.ts` the
  wrong-network notice on every screen and the switch.

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
- [ ] My stake (`/dashboard`) shows the hero, "Connect your wallet to see your stakes, rewards, and
      positions", a Connect Wallet button and a Browse validators link; no stat cards, no quick
      actions.
- [ ] Validators (`/validators`) lists the validator cards with name, participation rate and
      total stake, and states SEF's 75% participation rule as text. A rate SEF does not publish
      reads Not published, never 0.00%.
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
| 2 | My stake: your stats and the quick actions appear | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 3 | Delegate from a validator card: approve, then stake; Your Stake updates | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 4 | Undelegate: the withdrawal appears in the queue with its cooldown | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 5 | Withdrawals: Claim after the cooldown empties that entry | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 6 | Validator detail: your delegation to that validator is shown | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 7 | Rewards: Claim pays the available amount, and Your rewards and Programme update | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 8 | Rewards: Claim & Stake runs Claim → Stake → Done; the stake amount starts at what the claim paid | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |
| 9 | Rewards: an address without rewards says so, with no Claim | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail | ☐ Pass ☐ Fail |

On the fork, row 5 needs the chain's clock moved past the cooldown. Anvil's clock starts at the
pinned fork block, which is older than your computer's clock, and the interface times the
cooldown by your computer's clock. So the page can offer Claim before the chain allows it, and a
claim sent then reverts. After step 4, move the chain forward by at least the unstaking period
the Undelegate dialog showed, in seconds, and mine a block. With `<rpc>` the MetaMask RPC URL
`pnpm fork:up` printed, for a period of two days:

```sh
cast rpc evm_increaseTime 172860 --rpc-url <rpc>
cast rpc evm_mine --rpc-url <rpc>
```

Then reload the Withdrawals page and claim. `cast` comes with Foundry, which the fork already
needs. The fork suite moves the clock the same way, through `warp()` in `e2e/fork/chain.ts`.

Notes and transaction hashes:

```
(free-form notes per release)
```

## Staking details

- [ ] `?delegate=<address>` on `/validators` opens the delegate dialog for that validator.
- [ ] The 25%, 50%, 75% and MAX shortcuts fill the amount; Delegate stays disabled without one.
- [ ] The dialog shows a gas estimate and the unstaking period, in words, read from the contract.
- [ ] Stake opens "Before you stake … with …" and its five "What happens if" answers. Back returns
      to the form with the amount kept; only Confirm stake opens the wallet.
- [ ] With an allowance below the amount, both Approve exact amount and Approve unlimited unlock
      Stake, each on a separate run.
- [ ] Rejecting the wallet prompt shows an error and leaves the dialog usable.
- [ ] A validator SEF lists as inactive reads Withdrawn, keeps its figures, and cannot be staked
      with.
- [ ] With two or more pending withdrawals, only the oldest has Claim; claiming it reveals the
      next.

## Terms explained where they appear

- [ ] Each dotted-underlined term opens its explanation on hover, on keyboard focus and on a
      tap, and closes on Escape or a second tap: Safenet and staking on the Overview, rewards and
      Safenet on My stake, validator, stake and Commission on Validators, Commission on a
      validator's page, withdrawals on Withdrawals, rewards on Rewards, Unstaking period in both
      dialogs, and the unstaking period, slashing and rewards in "What happens if".
- [ ] The unstaking period reads the same in every place, and matches the contract's
      `withdrawDelay`.

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

Each gate fails closed. The restricted screen replaces the whole interface, names the gate that
closed it ("Closed by: …"), says why, and says what the visitor can do. A gate that refused shows
"… Restricted" and "This interface cannot lift the restriction." A gate that could not reach an
answer shows "… Check Failed" and a way to try again. The copy is `src/lib/restriction.ts`.

- [ ] **Location check, refused**: the e2e suite covers it with a mocked country. By hand, only
      from a location the hook blocks.
- [ ] **Location check, failed**: block requests to the two country lookup services named in
      `src/hooks/useGeoblockCheck.ts` in the browser's developer tools, clear the
      `geoblock_check` key in `localStorage`, and reload. Access Check Failed names the Location
      check. Remove the block and press Reload: the app returns.
- [ ] **Sanctions screening**, only for a build with `VITE_SANCTIONS_API_URL`: the app opens when
      the endpoint allows the visitor. A 403 shows Access Restricted, a failed request Access
      Check Failed, both naming Sanctions screening.
- [ ] **Wallet screening** needs an address the sanctions oracle in `packages/core` lists, so its
      refusal is left to the e2e suite. A connected test address must not see it.
- [ ] **Wrong network**, Browser Wallet and WalletConnect: connect on another chain, or switch
      chains during the session. Every page shows the Wrong network notice with the wallet's
      chain ID and Switch to Ethereum, the header shows Switch to Ethereum, and every action that
      sends a transaction is disabled or hidden. The figures stay. Switching from the notice
      removes it and restores the actions.

## Screen states

What each screen shows in each state. Every row is what the code does today, including where it
is weaker than it should be. "Restricted" and "Wrong network" are the same on every screen, from
the gates in `src/App.tsx` and `WrongNetworkNotice` in `src/components/layout/Layout.tsx`, and are
repeated in each table so a table can be checked alone.

### Before any screen

| State | What shows |
|---|---|
| Loading | A spinner, while the sanctions endpoint, the location lookup and, with a wallet, the sanctions oracle answer |
| Restricted, refused | "Access Restricted" for Sanctions screening or Location check, the latter naming the country; "Wallet Restricted" for Wallet screening, with Disconnect wallet |
| Restricted, check failed | "Access Check Failed" with Reload, or "Wallet Check Failed" with Try again and Disconnect wallet |
| Two gates closed | A refusal is named before a failed check; between two of a kind, Sanctions screening, which is checked first |
| Route loading | A spinner in the page area |
| A page throws | "Something went wrong", "An unexpected error occurred while loading this page." and Try Again; the header and footer stay |

### Network overview, `/`

| State | What shows |
|---|---|
| Loading | Skeletons for each figure; Data freshness reads "Mainnet subgraph: checking." and "Gnosis subgraph: checking." |
| Empty | "No validator holds stake yet." in Stake distribution; "No validator is registered yet." in Validators; "Not compared yet" for the rewards root |
| Error | A figure shows "Unavailable" and the reason. A subgraph that fails or is stale is replaced by contract reads, SEF's files or the Gnosis snapshot in core, each figure naming its source, and Data freshness says the subgraph is not used. Recent activity shows "Unavailable." and the reason. A section that throws shows "This section could not be shown." and Retry; the others stay |
| No wallet | The whole page; it needs none |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice above the page; the figures are unchanged |

### My stake, `/dashboard`

| State | What shows |
|---|---|
| Loading | Skeletons in the stat cards; "Your Rewards" with two skeletons; "Your Stake Distribution" with a skeleton. Claimable SAFE reads 0 until the rewards load |
| Empty | "You have no active stakes. Visit the Validators page to stake."; no stake distribution chart with fewer than two positions; Total claimed hidden at 0 |
| Error | A stat card whose read failed shows "Unavailable". SEF's validator list failing shows "SEF's validator list could not be loaded, so your stakes cannot be listed." and Retry. A failed per-validator stake read drops that row and that slice without a note. Claimable SAFE reads 0 when the rewards fail |
| No wallet | The hero, then "Connect your wallet to see your stakes, rewards, and positions" with Connect Wallet and Browse validators; no stat cards, quick actions, staking section or chart |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice; the stats stay; Unstake on a row still opens the dialog, whose submit button is disabled |

### Validators, `/validators`

| State | What shows |
|---|---|
| Loading | Four skeleton cards; per-card stake figures as skeletons |
| Empty | "No validators are currently available." and Refresh |
| Error | "Failed to load validators: " and the error. A failed stake read on a card shows 0 without a note; missing metadata shows "—" |
| No wallet | Cards without Your Stake, Stake or Unstake |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice; Stake and Unstake on the cards are disabled |

### Validator detail, `/validators/<address>`

| State | What shows |
|---|---|
| Loading | Two skeletons, then skeletons for the stake figures |
| Empty | "Invalid validator address." for a malformed address; "Validator not found." for one SEF does not list; Your SAFE Staked 0 without a stake |
| Error | SEF's validator list failing also shows "Validator not found."; a failed stake read shows 0 without a note |
| No wallet | Without Your SAFE Staked, Stake or Unstake |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice; Stake and Unstake disabled |

### Withdrawals, `/withdrawals`

| State | What shows |
|---|---|
| Loading | Two skeletons |
| Empty | "No pending withdrawals." |
| Error | "Your withdrawal queue could not be read from Ethereum." and Retry. An unknown unstaking period leaves the progress bar at 0% until the countdown ends; an unresolved validator is left unnamed |
| No wallet | "Connect your wallet to view withdrawal queue." |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice; the queue stays, with no Claim on a card, and Claim All disabled |

### Rewards, `/rewards`

| State | What shows |
|---|---|
| Loading | Skeletons in Your rewards, Programme and Verifiability; "Not compared yet" for the roots; Claim and Claim & Stake disabled without a note |
| Empty | "This address has not earned Safenet rewards. SEF publishes no reward file for it."; Actions says "This address has nothing to claim." or "Nothing to claim right now."; after a full claim with SAFE in the wallet, Stake your balance; "No rewards contract is configured for this network." without a MerkleDrop |
| Error | "Your rewards could not be loaded." and Retry; Actions says "Claiming needs your reward data, which did not load."; "SEF's published rewards file could not be loaded." in Programme, with Retry, and in Verifiability; "The MerkleDrop contract could not be read from Ethereum." with Retry, and "Unavailable" for its values |
| No wallet | Your rewards explains that a wallet is needed and shows Connect Wallet; Actions says "Connect a wallet to claim."; Programme and Verifiability render |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice; Actions says "Your wallet is on another network. Switch to Ethereum to claim." with both buttons disabled; Claim & Stake says "Switch to Ethereum to continue." |

### Not found, any other path

| State | What shows |
|---|---|
| Any | "404", "Page not found" and Back to Overview; it reads nothing and has no error boundary |
| Restricted | The restricted screen, as above |
| Wrong network | The Wrong network notice, from the layout |

## Accessibility

`e2e/tests/accessibility.spec.ts` runs axe on every route and state; `ACCESSIBILITY.md` says
what it covers. These need a person:

- [ ] Keyboard alone, from the address bar: reach and use every link and button, open and close
      every dialog, delegate, undelegate and claim. Focus is always visible and never lost.
- [ ] VoiceOver on macOS or NVDA on Windows: each page's heading and sections are announced, a
      term's explanation is read with its button, loading is announced, and an error is read
      when it appears.
- [ ] At 200% browser zoom, and at 320 px wide, nothing is cut off and nothing needs scrolling
      sideways.
- [ ] On a phone: every button can be hit with a thumb, terms open on a tap, dialogs fit.
- [ ] With reduced motion set in the operating system, nothing animates.

## Safe App

Use **`https://safenet.cobuilders.xyz`** as the Custom Safe App URL.
Do not use `eth.limo` or a `dweb` CID URL for this setup.
The `eth.limo` gateway sends CSP `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN`, which block Safe's iframe.
App code cannot override these gateway response headers. The earlier dweb URL failed Safe's app check.

Check the deployed headers with GET requests before testing in Safe:

```sh
curl -sS -D - -o /dev/null https://safenet.cobuilders.xyz/
curl -sS -D - -o /dev/null https://safenet.cobuilders.xyz/manifest.json
```

Both must return HTTP 200. The manifest must permit cross-origin access from `https://app.safe.global`.
Vercel currently sends `Access-Control-Allow-Origin: *` and no `frame-ancestors` or `X-Frame-Options` response headers.
Keep those responses compatible with Safe; do not add a CSP that excludes `https://app.safe.global` as a frame ancestor.

A local `pnpm --filter @cobuilders/safenet-web dev` or `preview` server also permits framing by Safe.
Its CORS, private-network and `frame-ancestors` headers come from `vite.config.ts`, which does not control deployed gateway headers.

- [ ] Open [Safe{Wallet}](https://app.safe.global) and select your Ethereum Mainnet Safe.
- [ ] Select Apps → My custom apps → Add custom app. Enter `https://safenet.cobuilders.xyz` and complete Safe's acknowledgement.
      Safe reads the manifest and shows the name, description and icon in `apps/web/public/manifest.json`.
- [ ] Open Safenet Staking. The iframe renders without "refused to connect" or a frame-policy error in the browser console.
- [ ] It connects through the Safe connector by itself: no Connect
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
