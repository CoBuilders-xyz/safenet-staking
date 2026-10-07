# Manual QA on a Mainnet fork

A way to test and demo Claim & Stake by hand against the real Safenet contracts, on demand, from
any machine. Anvil forks Mainnet at a pinned block. A test account gets SAFE in its wallet and a
reward to claim. The interface runs against that chain. Nothing touches Mainnet, and nothing
costs anything.

## Prerequisites

- Foundry, for `anvil`, which runs the fork. `pnpm bootstrap` checks for it and says how to
  install it.
- `.env.local` at the repository root with `MAINNET_RPC_URL`, an archive endpoint.
  `pnpm env:pull` writes it. A public endpoint cannot serve state at a pinned block.
- `pnpm bootstrap`, once per worktree. It installs the dependencies and writes `.env.ports`,
  which holds the three ports this environment uses.
- MetaMask, in a browser profile that holds no real wallet.

## The three commands

Run them at the repository root.

| Command | What it does |
|---|---|
| `pnpm fork:up` | Starts Anvil on the fork, builds the rewards, sets the chain up, starts the interface behind a local proxy, and prints what to open and what to import. Safe to run again: whatever is already up and right stays up. |
| `pnpm fork:reset` | Puts the chain back to the state `fork:up` left it in, so the flow can run again from the start. |
| `pnpm fork:down` | Stops Anvil, the interface and the proxy. Only what `fork:up` started, nothing else on the machine. |

`fork:up` takes a minute or two the first time. Most of it is the archive endpoint answering
Anvil's reads of the fork block. Everything it writes goes under `apps/web/.fork-env/`, which git
ignores: the logs, the generated proofs, and a record of the running processes.

## What the tester sees

`fork:up` ends with a summary like this one. The ports shown are the defaults; the real ones
come from `.env.ports`. The amounts are the defaults. The fork block and the data commit are
the ones `packages/core` pins, and the number of claimers follows from them.

```
  Open            http://127.0.0.1:5180/#/rewards
  MetaMask RPC    http://127.0.0.1:5180/rpc  on the Ethereum Mainnet network, chain id 1
  Account         0x…  Anvil's account 0; docs/manual-qa-fork.md says how to import it
  In the wallet   3000 SAFE
  To claim        742.318640275 SAFE
  Fork block      <the block core pins>
  Merkle root     0x…
  Carried over    <n> real claimers at their amounts in SEF's files at commit <the commit core pins>
```

The chain is Mainnet as it stood at the fork block, with three changes:

- The MerkleDrop holds a new Merkle root. The tree behind it is built with the repository's own
  tree code from every address that has claimed on Mainnet, at the cumulative amount in SEF's
  proof file for it, plus the test account at the test amount. The root was set by the contract's
  owner, which Anvil impersonates.
- The test account holds SAFE, moved from the staking contract, which Anvil also impersonates.
  Its Mainnet EIP-7702 delegation is cleared, so wallets treat it as a plain account.
- The MerkleDrop holds the test amount on top of its balance, so the claim is paid.

The default fork block is the fork suites' block, `MAINNET_FORK.blockNumber` in `packages/core`,
and SEF's files are read at the data commit core pins next to it, whose root is the one on chain
at that block. So every real claimer is carried over, and stays so when SEF publishes its next
root. The Rewards page shows the period end from that commit's
`latest.json`, and a file time stamped when `fork:up` built the rewards.

The interface reads the chain and the proofs through one origin, the proxy. `/rpc` goes to
Anvil, `/rewards/` serves the generated proofs and `latest.json`, and everything else is the Vite
dev server. MetaMask talks to the same `/rpc`.

Vite starts with six settings of the tool's: `VITE_RPC_URL` and `VITE_REWARDS_BASE_URL` under
the proxy origin, `VITE_RPC_URL_FALLBACK_1` and `VITE_RPC_URL_FALLBACK_2` empty, so no read
falls back to the real chain, `VITE_VALIDATOR_INFO_URL` at the same commit as the proofs, so
every validator the Stake step offers is registered on the fork, and `VITE_STAKING_DEPLOY_BLOCK`
at the fork block, so the interface's log scans start there, as in the fork suite: the test
account has no history before it. From the shell it inherits only
an allowlist: `PATH`, `HOME`, the user, shell and temporary directory, the locale, time zone,
terminal and colour variables, `CI`, `NODE_OPTIONS`, `NODE_ENV`, `NODE_EXTRA_CA_CERTS`, and any
`QA_` or `VITE_` variable. No other exported variable, and nothing of `.env.local` but its
`VITE_` values, which Vite reads itself as it always does. The six above win over both.

The Network Overview reads the same generated `latest.json` and validator list. Its other
figures come from the subgraphs, and the tool sets no subgraph URL: the interface uses the
defaults in `packages/core`, the Studio deployments, which index the real chains. So where the
Overview shows a subgraph figure, it is today's Mainnet or Gnosis, not the fork's.

## MetaMask

Use a browser profile with no real wallet in it. The test account's key is public: anyone who
knows it can move whatever that address holds on any chain.

1. Import the account. It is account 0 of Anvil's public test mnemonic, which
   `packages/core` pins as `ANVIL_TEST_MNEMONIC`. Its key is the first one Anvil prints under
   Private Keys when it starts, in `apps/web/.fork-env/anvil.log`, after `(0)`:

   ```sh
   grep -m 1 -E '^\(0\) 0x[0-9a-f]{64}$' apps/web/.fork-env/anvil.log
   ```

   In MetaMask: account menu, Add account or hardware wallet, Import account, paste the key. The
   address must match the one `fork:up` printed.
2. Point Ethereum Mainnet at the fork. Settings, Networks, Ethereum Mainnet, Add RPC URL, paste
   the MetaMask RPC URL from the summary, save, and select it. The chain id stays 1, so the
   interface, which is built for Mainnet, needs no change. Switch the RPC URL back when the
   session ends.
3. Open the address `fork:up` printed. MetaMask shows about 10,000 ETH, Anvil's gas money.

## The walk-through

1. Open the `Open` address from the summary. The Rewards page loads.
2. Connect, with MetaMask and the imported account.
3. Your rewards shows Available to claim: 742.3186 SAFE by default. The interface rounds to four
   decimals; the summary prints the exact amount. Actions offers Claim & Stake and Claim.
4. Press Claim & Stake. The dialog opens on its Claim step and shows the claimable SAFE.
5. Press Claim 742.3186 SAFE and confirm in MetaMask. The dialog moves to the Stake step. It says
   what the claim paid, and the amount is already filled in.
6. Choose a validator.
7. Press Approve exact amount, or Approve unlimited, and confirm. Then press Stake and confirm.
   A wallet that batches shows one Stake button and asks for one confirmation.
8. The Done step says what was staked and with whom.
9. Press Close. The Rewards page now shows Available to claim: 0 SAFE, and Actions offers Stake
   your balance, for the SAFE still in the wallet.

The abandon path, after a `pnpm fork:reset`:

1. Steps 1 to 5 again, so the claim is paid and the Stake step is open.
2. Close the dialog. It warns that the claimed SAFE is in the wallet and not staked, with two
   choices: Stake now, which returns to the Stake step, and Close anyway, which closes it.
3. After Close anyway, the Rewards page shows Available to claim: 0 SAFE and Stake your
   balance.

## Between runs

`pnpm fork:reset` reverts the chain to the baseline and takes a new snapshot of it. Then, in
MetaMask, clear the imported account's activity: Settings, Advanced, Clear activity tab data.
Without that MetaMask reuses nonces the chain no longer has, and every transaction fails.

If the snapshot is gone, because Anvil restarted, `fork:reset` rebuilds the baseline from
scratch, the same way `fork:up` does.

## Settings

Every one is an environment variable. The ports are in `.env.ports` too, where an exported
variable wins.

| Variable | Default | What it sets |
|---|---|---|
| `QA_ANVIL_PORT` | from `.env.ports`, else 8547 | Anvil. Loopback only. |
| `QA_WEB_PORT` | from `.env.ports`, else 5179 | The Vite dev server behind the proxy. Loopback only. |
| `QA_PROXY_PORT` | from `.env.ports`, else 5180 | The proxy, the one port a browser and MetaMask use. |
| `QA_PROXY_HOST` | `127.0.0.1` | The interface the proxy binds. |
| `QA_PROXY_ORIGIN` | `http://127.0.0.1:<QA_PROXY_PORT>` | The origin the interface and MetaMask reach the proxy at. It is built into the app. |
| `QA_FORK_BLOCK` | `MAINNET_FORK.blockNumber` in `packages/core` | The Mainnet block the fork starts from. |
| `QA_SEF_DATA_COMMIT` | `MAINNET_FORK.sefData.commit` in `packages/core` | Where SEF's proofs, `latest.json` and validator list are read: a full commit hash of SEF's data repository, or `main` for the live files. |
| `QA_TEST_AMOUNT` | 742.318640275 | What the test account has to claim, in SAFE. |
| `QA_TEST_BALANCE` | 3000 | What the test account holds before the claim, in SAFE. |
| `MAINNET_RPC_URL` | from `.env.local` | The archive endpoint Anvil forks from. Never printed. Anvil's log has its URL replaced. |

A change to `QA_ANVIL_PORT`, the block, the data commit or the amounts makes the next `fork:up`
restart Anvil and rebuild the baseline. A change to `QA_WEB_PORT`, `QA_PROXY_PORT`,
`QA_PROXY_HOST`, the origin, `QA_ANVIL_PORT`, the block or the data commit makes it restart the
proxy: the proxy forwards to the Anvil port, and its Vite carries the origin, the block as the
floor of its log scans, and the validator list of the data commit.

One fork command runs at a time; a second one started meanwhile says so and stops. A command
interrupted with Ctrl-C or SIGTERM releases the lock. One killed outright leaves it, and the
next command takes it over once the process that held it is gone.

A new port must be free. `fork:up` checks every port first. When a process the tool did not
start holds one, it says so and stops before it stops anything of its own, and the fork already
running stays up on its old ports.
`fork:down` stops the running fork on the ports it was started on, whatever the settings say
now. The ports in `.env.ports` are chosen per worktree to stay clear of the fork suites and of
other worktrees; pick another one by hand only when something else holds them.

The default block and the default commit are the pair `packages/core` pins for the fork suites:
the commit's proofs carry the root on chain at the block, so every real claimer is carried
over. The two must match. SEF publishes a new root about
every two weeks and rewrites every proof file with it. To fork a block after a newer root
reached the chain, set `QA_FORK_BLOCK` to it and `QA_SEF_DATA_COMMIT` to a commit of SEF's data
that carries that root, or to `main` while the live files still do. With a mismatch, `fork:up`
says so, reports 0 claimers carried over, and only the test account has something to claim,
which is enough for the walk-through.

## Reaching the proxy from another machine

The proxy binds loopback. Exposing it further is the operator's choice: through a tunnel or a
reverse proxy of their own, or by binding another interface with `QA_PROXY_HOST`. Whatever the
browser will use as the origin goes in `QA_PROXY_ORIGIN` before `fork:up`, because the app's
bundle carries it as its RPC and rewards base. The RPC behind it is an Anvil with unlocked
accounts and cheat methods, so expose it only to the people testing.

## When something is off

- `Port … is in use, and not by an Anvil this tool started`, or `not by a process this tool
  started` for the proxy and Vite: something else holds the port. `fork:up` never stops a
  process it did not start. It checks the ports before it stops or changes anything, and sets
  the chain up only on an Anvil it started that reported it listens on the port. Stop the
  other process yourself, or pick another port.
- `cannot read the start time of process …`: the tool tells its own processes from others by
  pid and start time. On Linux it reads `/proc`; elsewhere it runs `ps -o lstart=`. When it
  cannot read the start time of a process it is about to record, it starts nothing, because it
  could not stop it safely later. When it cannot read that of a running process its records
  name, it neither stops nor forgets it, and changes nothing. Run the command again.
- `reading SEF's rewards/…: …`: a file of SEF's data could not be read. The message names the
  file, `latest.json` or one claimer's `proofs/…` file; the URL is redacted.
- The interface loads but shows nothing to claim: the account connected is not the imported one.
  The interface reads the chain through the proxy, not through MetaMask.
- The claim fails in MetaMask before it is sent, or MetaMask shows the wrong balances: MetaMask
  is on another RPC URL. The one to use is in the summary.
- A transaction fails at once in MetaMask after a reset: clear the activity data, as above.
- `fork:up` stalls at `starting a fork of Mainnet`: Anvil is waiting on the archive endpoint. Its
  log is `apps/web/.fork-env/anvil.log`, with URLs removed. The proxy and Vite log to
  `apps/web/.fork-env/proxy.log`.
- To see which process holds a port, list by port, never by command line: Anvil's command line
  carries the archive endpoint, and that URL carries a key.

  ```sh
  lsof -tiTCP:<port> -sTCP:LISTEN
  ```
