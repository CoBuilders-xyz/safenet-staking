# safenet command reference

Every `safenet` command, with its arguments and options, one example, and what it printed against
Ethereum Mainnet. The [README](../README.md) covers installation, signing and settings.

## How to read the samples

The samples are real runs against Ethereum Mainnet on 2026-10-27, around block 26,286,990, through
an archive endpoint in `MAINNET_RPC_URL`, on Node.js 22.14.0. Each shows the human format, then a
separate run of the same command with `--json`, seconds later, so the two can name blocks a few
apart. Your figures will differ: the chain and SEF's files move on.

These historical samples are preserved from revision `73de947ba1f2f7ab9cd74331ee9900c5114bff77`.
They predate the ENSIP-10 fix in #71 and WalletConnect support in #73.
The old wildcard-resolver `unsupported` result below does not describe the current resolver.
Current code follows ENSIP-10 and tries the IPFS dataset before the repository mirror.
The option tables below include the current WalletConnect flags.

Some values in the samples are replaced with a label in angle brackets:

- A URL is `<redacted-url>`. An RPC URL can carry a key, and the reward file URLs only repeat
  where SEF publishes.
- A contract's address is its name, such as `<Staking address>`, and the block a log scan starts
  from is the contract's deploy block, such as `<Staking deploy block>`. A validator's address is
  `<validator NAME>`, after the label SEF gives it.
- The staker in the examples is `<staker>`, and the address with rewards to claim is `<claimant>`.
  Their transaction hashes and Merkle proof nodes are labels too. Both addresses are public data
  on chain, and the labels only keep the samples readable: they hide nothing from a reader who
  looks the figures up. A claim's block and amount find its `Claimed` log, and a cumulative amount
  finds the claimant in SEF's public proof files.
- In `--json`, the `data` of a transaction keeps the 4-byte function selector only; the rest of the
  calldata repeats the arguments shown above it. Where a long array is cut, the section says so.

A label is padded to the width of the value it replaces, so the tables keep their columns.

## Global options

These go before or after the command.

| Option | What it does |
|---|---|
| `--json` | Print one JSON document on stdout, with the same fields. Amounts are wei as decimal strings |
| `--rpc-url <url>` | The Mainnet RPC endpoint. Default: `MAINNET_RPC_URL`, then the public endpoints |
| `-v`, `--verbose` | Print the RPC host in use, never its full URL, to stderr |
| `-V`, `--version` | Print the version |
| `-h`, `--help` | Print help for the program or for one command |

Exit codes: 0 on success; 1 when the operation failed, with one sentence on stderr; 2 on a usage
error.

`validators show` (its delegators count), `withdrawals list` without `--address`, and
`rewards history` scan the chain's logs from a contract's deploy block. The public endpoints refuse
such scans, so these need an archive endpoint.

## Reads

### `safenet status`

The network's totals: SAFE staked, on chain and in SEF's snapshot; validators active and
registered; pending withdrawals; the rewards SEF allocated, the period they cover, and what the
MerkleDrop still holds; and whether the Merkle root on chain is the root SEF published. It
describes the network, not a wallet: it takes no address.

Rewards unclaimed are derived only while the root on chain is the published root. Otherwise they
are `null`, with a reason, and only the MerkleDrop's raw balance is shown.

Options: none besides the global options.

```sh
safenet status
```

```text
Safenet on Ethereum Mainnet, block 26,286,983

FIGURE                     VALUE                                                                                       SOURCE
SAFE staked                69,560,833.162022313723058414 SAFE                                                          chain: Staking.totalStakedAmount()
SAFE staked, SEF snapshot  69,560,688.211255109215240029 SAFE                                                          SEF: network-info.json total_staked_amount, a snapshot published every 3 hours
Active validators          4                                                                                           SEF: validator-info.json is_active
Registered validators      5 of 6 listed                                                                               chain: Staking.isValidator() for each address in SEF's validator-info.json
Pending withdrawals        5,924,343.977566872354969673 SAFE                                                           chain: Staking.totalPendingWithdrawals()
Rewards allocated          4,499,987.77480767027120197 SAFE                                                            SEF: rewards/latest.json tokenTotal
Rewards period             epoch 0, rewards until 2026-10-06 00:00 UTC                                                 SEF: rewards/latest.json epoch, rewardsUntil
Rewards unclaimed          308,516.417160356008138174 SAFE                                                             chain: SAFE.balanceOf(MerkleDrop), while its root is the published one
SAFE held by MerkleDrop    308,516.417160356008138174 SAFE                                                             chain: SAFE.balanceOf(MerkleDrop)
Merkle root, chain         0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef                          chain: MerkleDrop.merkleRoot()
Merkle root, published     0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef                          SEF: rewards/latest.json merkleRoot
Rewards data               SEF's repository, a mirror: rewards.safenet-gov.eth is set in a form this tool cannot read  <redacted-url>

Merkle root: match. The root on chain is the root in SEF's latest.json.
```

```sh
safenet status --json
```

```json
{
  "block": "26286984",
  "totalStaked": {
    "value": "69560833162022313723058414",
    "source": "chain: Staking.totalStakedAmount()"
  },
  "totalStakedPublished": {
    "value": "69560688211255109215240029",
    "source": "SEF: network-info.json total_staked_amount, a snapshot published every 3 hours"
  },
  "activeValidators": {
    "value": 4,
    "source": "SEF: validator-info.json is_active"
  },
  "registeredValidators": {
    "value": {
      "registered": 5,
      "listed": 6
    },
    "source": "chain: Staking.isValidator() for each address in SEF's validator-info.json"
  },
  "pendingWithdrawals": {
    "value": "5924343977566872354969673",
    "source": "chain: Staking.totalPendingWithdrawals()"
  },
  "rewardsAllocated": {
    "value": "4499987774807670271201970",
    "source": "SEF: rewards/latest.json tokenTotal"
  },
  "rewardsEpoch": {
    "value": {
      "epoch": 0,
      "rewardsUntil": "2026-10-06T00:00:00.000Z"
    },
    "source": "SEF: rewards/latest.json epoch, rewardsUntil"
  },
  "rewardsUnclaimed": {
    "value": "308516417160356008138174",
    "source": "chain: SAFE.balanceOf(MerkleDrop), while its root is the published one"
  },
  "merkleDropBalance": {
    "value": "308516417160356008138174",
    "source": "chain: SAFE.balanceOf(MerkleDrop)"
  },
  "merkleRoot": {
    "onChain": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "chain: MerkleDrop.merkleRoot()"
    },
    "published": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "SEF: rewards/latest.json merkleRoot"
    },
    "match": true
  },
  "rewardsSource": {
    "kind": "repository",
    "url": "<redacted-url>",
    "gateway": null,
    "tried": [
      {
        "kind": "repository",
        "url": "<redacted-url>",
        "gateway": null,
        "outcome": "found",
        "reason": null
      }
    ],
    "ens": {
      "name": "rewards.safenet-gov.eth",
      "status": "unsupported",
      "contenthash": null,
      "reason": "the name is served by a parent's wildcard resolver"
    }
  }
}
```

`rewardsSource` names where `rewards/latest.json` was read: SEF's IPFS dataset behind
`rewards.safenet-gov.eth`, or the repository mirror, with each source tried and its outcome. The
README's "Reward data" section explains the order.

### `safenet validators list`

Every validator in SEF's `validator-info.json`, with its stake and registration read from the
chain, and its label, participation, commission and active flag from SEF. The participation rate
covers the window printed on the first line. A rate SEF does not publish prints as "not published",
and is `null` with `--json`; it is never shown as 0.

| Option | What it does |
|---|---|
| `--active` | Only the validators SEF marks active. The default |
| `--all` | Also the validators SEF marks inactive |
| `--sort <key>` | `stake` (the default) or `participation`, highest first |

```sh
safenet validators list
```

```text
Participation: 14-day window, 2026-10-13 19:00 UTC to 2026-10-27 19:00 UTC: SEF published at 2026-10-27 19:17 UTC (commit 99963fb), floored to the hour.

LABEL              ADDRESS                                                                  STAKE   SHARE  PARTICIPATION (14d)  COMMISSION  ACTIVE  REGISTERED
Gnosis             <validator Gnosis>                          19,992,282.134777049144328363 SAFE  28.74%             100.000%       5.00%  yes     yes
Core Contributors  <validator Core Contributors>               15,626,677.613413900683879347 SAFE  22.46%              99.787%       5.00%  yes     yes
Safe Labs          <validator Safe Labs>                       14,644,357.805936637363943797 SAFE  21.05%             100.000%       5.00%  yes     yes
Greenfield         <validator Greenfield>                      13,477,385.100802047047713745 SAFE  19.37%             100.000%       5.00%  yes     yes

4 validators, active only, sorted by stake. Ethereum Mainnet block 26,286,984.
Sources: stake and share from Staking.totalValidatorStakes() and registered from Staking.isValidator(), on chain; label, participation, commission and active from SEF's validator-info.json.
```

```sh
safenet validators list --json
```

```json
{
  "block": "26286984",
  "filter": "active",
  "sort": "stake",
  "window": {
    "days": 14,
    "start": "2026-10-13T19:00:00.000Z",
    "end": "2026-10-27T19:00:00.000Z",
    "publishedAt": "2026-10-27T19:17:59.000Z",
    "commit": "99963fb90ad07b7f23a60beed0f3e619e83a256a"
  },
  "totalStaked": {
    "value": "69560833162022313723058414",
    "source": "chain: Staking.totalStakedAmount()"
  },
  "validators": [
    {
      "address": "<validator Gnosis>",
      "label": "Gnosis",
      "active": true,
      "registered": true,
      "commission": 0.05,
      "stake": "19992282134777049144328363",
      "share": 0.287407169,
      "participation": 1
    },
    {
      "address": "<validator Core Contributors>",
      "label": "Core Contributors",
      "active": true,
      "registered": true,
      "commission": 0.05,
      "stake": "15626677613413900683879347",
      "share": 0.224647648,
      "participation": 0.997872340425532
    },
    {
      "address": "<validator Safe Labs>",
      "label": "Safe Labs",
      "active": true,
      "registered": true,
      "commission": 0.05,
      "stake": "14644357805936637363943797",
      "share": 0.210525911,
      "participation": 1
    },
    {
      "address": "<validator Greenfield>",
      "label": "Greenfield",
      "active": true,
      "registered": true,
      "commission": 0.05,
      "stake": "13477385100802047047713745",
      "share": 0.193749621,
      "participation": 1
    }
  ],
  "sources": {
    "label": "SEF: validator-info.json label",
    "active": "SEF: validator-info.json is_active",
    "registered": "chain: Staking.isValidator()",
    "commission": "SEF: validator-info.json commission",
    "stake": "chain: Staking.totalValidatorStakes()",
    "share": "chain: Staking.totalValidatorStakes() / Staking.totalStakedAmount()",
    "participation": "SEF: validator-info.json participation_rate_14d"
  }
}
```

With `--all --sort participation`:

```text
Participation: 14-day window, 2026-10-13 19:00 UTC to 2026-10-27 19:00 UTC: SEF published at 2026-10-27 19:17 UTC (commit 99963fb), floored to the hour.

LABEL               ADDRESS                                                                  STAKE   SHARE  PARTICIPATION (14d)  COMMISSION  ACTIVE  REGISTERED
Gnosis              <validator Gnosis>                          19,992,282.134777049144328363 SAFE  28.74%             100.000%       5.00%  yes     yes
Greenfield          <validator Greenfield>                      13,477,385.100802047047713745 SAFE  19.37%             100.000%       5.00%  yes     yes
Safe Labs           <validator Safe Labs>                       14,644,357.805936637363943797 SAFE  21.05%             100.000%       5.00%  yes     yes
Core Contributors   <validator Core Contributors>               15,626,677.613413900683879347 SAFE  22.46%              99.787%       5.00%  yes     yes
RockawayX           <validator RockawayX>                        3,004,952.549603370333402234 SAFE   4.32%              11.277%       5.00%  no      yes
Blockchain Capital  <validator Blockchain Capital>               2,815,177.957489309149790928 SAFE   4.05%               0.000%       5.00%  no      no

6 validators, all, sorted by participation. Ethereum Mainnet block 26,286,984.
Sources: stake and share from Staking.totalValidatorStakes() and registered from Staking.isValidator(), on chain; label, participation, commission and active from SEF's validator-info.json.
```

### `safenet validators show <address>`

One validator: the fields of `validators list`, and its delegators. The delegators count comes from
the `StakeIncreased` logs for the validator, then `stakes(staker, validator)` for each staker found;
"current" counts the stakers whose stake is above zero now. Without an archive endpoint the scan is
refused, and the count prints as unavailable. A participation rate SEF does not publish prints as
"not published", and is `null` with `--json`.

| Argument | What it is |
|---|---|
| `<address>` | The validator's address |

```sh
safenet validators show <validator address>
```

```text
Validator on Ethereum Mainnet, block 26,286,984

FIELD                VALUE                                       SOURCE
Label                Gnosis                                      SEF: validator-info.json label
Address              <validator Gnosis>
Active               yes                                         SEF: validator-info.json is_active
Registered           yes                                         chain: Staking.isValidator()
Stake                19,992,282.134777049144328363 SAFE          chain: Staking.totalValidatorStakes()
Share of all stake   28.74%                                      chain: Staking.totalValidatorStakes() / Staking.totalStakedAmount()
Participation (14d)  100.000%                                    SEF: validator-info.json participation_rate_14d
Commission           5.00%                                       SEF: validator-info.json commission
Delegators           446 current, 463 ever                       chain: StakeIncreased logs for this validator from block <Staking deploy block>, then Staking.stakes(staker, validator) > 0

Participation: 14-day window, 2026-10-13 19:00 UTC to 2026-10-27 19:00 UTC: SEF published at 2026-10-27 19:17 UTC (commit 99963fb), floored to the hour.
```

```sh
safenet validators show <validator address> --json
```

```json
{
  "block": "26286985",
  "window": {
    "days": 14,
    "start": "2026-10-13T19:00:00.000Z",
    "end": "2026-10-27T19:00:00.000Z",
    "publishedAt": "2026-10-27T19:17:59.000Z",
    "commit": "99963fb90ad07b7f23a60beed0f3e619e83a256a"
  },
  "validator": {
    "address": "<validator Gnosis>",
    "label": "Gnosis",
    "active": true,
    "registered": true,
    "commission": 0.05,
    "stake": "19992282134777049144328363",
    "share": 0.287407169,
    "participation": 1
  },
  "delegators": {
    "value": {
      "current": 446,
      "ever": 463
    },
    "source": "chain: StakeIncreased logs for this validator from block <Staking deploy block>, then Staking.stakes(staker, validator) > 0"
  },
  "sources": {
    "label": "SEF: validator-info.json label",
    "active": "SEF: validator-info.json is_active",
    "registered": "chain: Staking.isValidator()",
    "commission": "SEF: validator-info.json commission",
    "stake": "chain: Staking.totalValidatorStakes()",
    "share": "chain: Staking.totalValidatorStakes() / Staking.totalStakedAmount()",
    "participation": "SEF: validator-info.json participation_rate_14d"
  }
}
```

### `safenet withdrawals list`

Without `--address`: the SAFE pending withdrawal across the network, from
`totalPendingWithdrawals()`, and the count of withdrawals still open in the logs, checked against
that total. With `--address`: one staker's queue, from `getPendingWithdrawals(staker)`, with the
time each becomes claimable.

| Option | What it does |
|---|---|
| `--address <address>` | One staker's pending withdrawals, instead of the network figures |

```sh
safenet withdrawals list
```

```text
Pending withdrawals on Ethereum Mainnet, block 26,286,986

FIGURE         VALUE                              SOURCE
Total pending  5,924,343.977566872354969673 SAFE  chain: Staking.totalPendingWithdrawals()
Count pending  21                                 chain: WithdrawalInitiated logs without a WithdrawalClaimed for the same staker and id, from block <Staking deploy block>
History        118 initiated, 97 claimed          chain: WithdrawalInitiated and WithdrawalClaimed logs

Check: the 21 open withdrawals in the logs sum to the total on chain.
```

```sh
safenet withdrawals list --json
```

```json
{
  "scope": "network",
  "block": "26286986",
  "total": {
    "value": "5924343977566872354969673",
    "source": "chain: Staking.totalPendingWithdrawals()"
  },
  "count": {
    "value": 21,
    "source": "chain: WithdrawalInitiated logs without a WithdrawalClaimed for the same staker and id, from block <Staking deploy block>"
  },
  "initiated": 118,
  "claimed": 97,
  "openSum": "5924343977566872354969673",
  "logsMatchChain": true
}
```

```sh
safenet withdrawals list --address <staker>
```

```text
Pending withdrawals for <staker>, Ethereum Mainnet block 26,286,987 (2026-10-27 22:17 UTC)

#    AMOUNT  CLAIMABLE AT          STATUS
1  200 SAFE  2026-10-10 09:02 UTC  claimable now

1 pending, 200 SAFE in total. Status is measured against the block time.
Source: chain: Staking.getPendingWithdrawals(staker).
```

```sh
safenet withdrawals list --address <staker> --json
```

```json
{
  "scope": "address",
  "block": "26286987",
  "blockTime": "2026-10-27T22:17:59.000Z",
  "address": "<staker>",
  "withdrawals": {
    "value": [
      {
        "amount": "200000000000000000000",
        "claimableAt": "2026-10-10T09:02:59.000Z",
        "claimableNow": true
      }
    ],
    "source": "chain: Staking.getPendingWithdrawals(staker)"
  },
  "total": "200000000000000000000"
}
```

### `safenet rewards check <address>`

What an address earned to date, from its proof file in SEF's data, against what it has claimed, from
`cumulativeClaimed()` on chain. The difference is claimable. It can be claimed only while the proof's
root is the root on chain. When SEF holds part of an address's rewards until a compliance check
passes, the proof's `kycAmount` shows it as held.

| Argument | What it is |
|---|---|
| `<address>` | The staker's address |

```sh
safenet rewards check <staker>
```

```text
Rewards for <staker>, Ethereum Mainnet block 26,286,987

FIGURE                   VALUE                                                                                       SOURCE
Earned to date           102.208838566303287235 SAFE                                                                 SEF: the address's reward proof file, cumulativeAmount
Claimed                  102.208838566303287235 SAFE                                                                 chain: MerkleDrop.cumulativeClaimed(address)
Claimable                0 SAFE                                                                                      cumulativeAmount minus cumulativeClaimed
Can claim                no                                                                                          claimable > 0 and the proof's root is the root on chain
kycAmount                0 SAFE                                                                                      SEF: the address's reward proof file, kycAmount
Held pending compliance  0 SAFE                                                                                      kycAmount, unless kyc is true
Proof read from          SEF's repository, a mirror: rewards.safenet-gov.eth is set in a form this tool cannot read  <redacted-url>
Merkle root, chain       0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef                          chain: MerkleDrop.merkleRoot()
Merkle root, proof       0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef                          SEF: the address's reward proof file, merkleRoot

Proof: match. Its root is the root on chain.
```

```sh
safenet rewards check <staker> --json
```

```json
{
  "block": "26286987",
  "address": "<staker>",
  "earned": true,
  "proofUrl": "<redacted-url>",
  "proofSource": {
    "kind": "repository",
    "url": "<redacted-url>",
    "gateway": null,
    "tried": [
      {
        "kind": "repository",
        "url": "<redacted-url>",
        "gateway": null,
        "outcome": "found",
        "reason": null
      }
    ],
    "ens": {
      "name": "rewards.safenet-gov.eth",
      "status": "unsupported",
      "contenthash": null,
      "reason": "the name is served by a parent's wildcard resolver"
    }
  },
  "cumulative": {
    "value": "102208838566303287235",
    "source": "SEF: the address's reward proof file, cumulativeAmount"
  },
  "claimed": {
    "value": "102208838566303287235",
    "source": "chain: MerkleDrop.cumulativeClaimed(address)"
  },
  "claimable": {
    "value": "0",
    "source": "cumulativeAmount minus cumulativeClaimed"
  },
  "canClaim": {
    "value": false,
    "source": "claimable > 0 and the proof's root is the root on chain"
  },
  "kycAmount": {
    "value": "0",
    "source": "SEF: the address's reward proof file, kycAmount"
  },
  "kycPassed": {
    "value": null,
    "source": "SEF: the address's reward proof file, kyc"
  },
  "heldPendingCompliance": "0",
  "root": {
    "onChain": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "chain: MerkleDrop.merkleRoot()"
    },
    "proof": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "SEF: the address's reward proof file, merkleRoot"
    },
    "status": "match"
  }
}
```

### `safenet rewards history <address>`

The address's past reward claims: one row per `Claimed` log of the MerkleDrop, newest first, with
the block, its time, the amount the claim paid and the transaction. It lists claims, not rewards
earned per period. A claim pays everything earned up to the root it proves, minus what was claimed
before, so one row can cover several periods, and a period that was never claimed has no row of its
own. The total is summed over every claim, shown or not, and checked against `cumulativeClaimed()`.

| Argument or option | What it is |
|---|---|
| `<address>` | The staker's address |
| `--all` | Every claim. Without it, the newest 20 |

```sh
safenet rewards history <staker>
```

```text
Reward claims by <staker>, Ethereum Mainnet block 26,286,988

TIME                       BLOCK                      AMOUNT  TRANSACTION
2026-10-08 09:02 UTC  26,146,657   11.37723510768138583 SAFE  <transaction hash>
2026-09-14 08:26 UTC  25,974,489  17.408113537074835959 SAFE  <transaction hash>
2026-07-30 06:50 UTC  25,643,989   6.981751073554296229 SAFE  <transaction hash>
2026-07-17 07:28 UTC  25,550,915  15.434448279446221109 SAFE  <transaction hash>
2026-06-18 07:11 UTC  25,342,872  15.874356876256680234 SAFE  <transaction hash>
2026-05-20 08:30 UTC  25,135,263   8.344028647739043126 SAFE  <transaction hash>
2026-05-06 10:50 UTC  25,035,500    8.47250164042938639 SAFE  <transaction hash>
2026-04-22 16:17 UTC  24,936,612  18.316403404121438358 SAFE  <transaction hash>

8 claims, newest first.
Claimed in total: 102.208838566303287235 SAFE, equal to chain: MerkleDrop.cumulativeClaimed(address).
Source: chain: MerkleDrop Claimed logs for this account, from block <MerkleDrop deploy block>.
```

```sh
safenet rewards history <staker> --json
```

The `claims` array is cut to its first two entries here; the run returned eight.

```json
{
  "block": "26286988",
  "address": "<staker>",
  "source": "chain: MerkleDrop Claimed logs for this account, from block <MerkleDrop deploy block>",
  "count": 8,
  "claims": [
    {
      "block": "26146657",
      "time": "2026-10-08T09:02:59.000Z",
      "transaction": "<transaction hash>",
      "amount": "11377235107681385830"
    },
    {
      "block": "25974489",
      "time": "2026-09-14T08:26:35.000Z",
      "transaction": "<transaction hash>",
      "amount": "17408113537074835959"
    }
  ],
  "limited": false,
  "totalClaimed": "102208838566303287235",
  "cumulativeClaimed": {
    "value": "102208838566303287235",
    "source": "chain: MerkleDrop.cumulativeClaimed(address)"
  },
  "sumMatchesChain": true
}
```

`limited` is `true` when claims were left out because `--all` was not given.

## Writes

The five writes send what the web interface sends, in the same order. Each simulates and estimates
every transaction before it sends anything, so a revert is decoded first and reported in one
sentence.

Every write takes these options:

| Option | What it does |
|---|---|
| `--dry-run` | Read, simulate and estimate every transaction, and print what would be sent. Nothing is signed |
| `--private-key-env <NAME>` | Sign with the private key held in the environment variable NAME |
| `--walletconnect` | Pair an external wallet through WalletConnect; requires `--wallet-account` |
| `--wallet-account <address>` | Require this Mainnet account from the paired wallet |
| `--keystore <path>` | Sign with a version 3 keystore file. The password is asked for without echo |
| `--password-env <NAME>` | With `--keystore`: read the password from the environment variable NAME |
| `--from <address>` | With `--dry-run` and no signer option: the address to simulate from |

Without `--dry-run`, choose `--private-key-env`, `--keystore`, or `--walletconnect` with `--wallet-account`.
A write without a signer exits 2. Signer options cannot be combined.
WalletConnect requires a terminal, `WALLETCONNECT_PROJECT_ID`, and a wallet supporting `eth_signTransaction`.
Confirm pairing URI display deliberately. Keep the URI out of logs and evidence.
See [Signing](../README.md#signing) for wallet compatibility and session safeguards.
With `--dry-run`, WalletConnect obtains the account but signs and broadcasts nothing.
A key loaded from `--private-key-env` prints this line on stderr, in a live run and in a dry run:

```text
Warning: environment private keys enter this process and can leak through process inspection or diagnostics. Prefer a hardware wallet or a keystore (--keystore), which keeps the key encrypted on disk.
```

A live write first checks that the endpoint is on chain 1. It reports each transaction on stderr
as it lands, so `--json` stays one document on stdout. The lines have this form; it is the format,
not a recording:

```text
sent Staking.stake: <hash>, waiting for its receipt
confirmed Staking.stake: <hash>, block <number>, status success, gas used <gas>
```

The samples below are dry runs with `--from`. A live run prints the same, with each transaction's
hash, block, status and gas used in place of "no, dry run", and `transaction` filled in `--json`.

A call that depends on an earlier one in the same command, such as a stake after its approval,
cannot be estimated with `eth_estimateGas`, which sees mined state only. A dry run simulates it with
`eth_simulateV1` after the calls before it, and its gas is the gas the simulation used.

### `safenet stake <validator> <amount>`

Stakes SAFE on a validator. It sends `approve` on the SAFE token first only when the allowance is
below the amount, then `stake(validator, amount)`.

| Argument or option | What it is |
|---|---|
| `<validator>` | The validator's address |
| `<amount>` | SAFE to stake, such as `100` or `0.5`, exactly, up to 18 decimals |
| `--approve <kind>` | When an approval is needed: `exact`, the amount (the default), or `unlimited` |

```sh
safenet stake <validator address> 1 --dry-run --from <staker>
```

```text
Stake 1 SAFE on validator <validator Gnosis>, from <staker>
Dry run against Ethereum Mainnet block 26,286,989: simulated and estimated, nothing signed or sent.

FIGURE        VALUE                        SOURCE
SAFE balance  155.474930438926870212 SAFE  chain: SAFE.balanceOf(staker)
Allowance     0 SAFE                       chain: SAFE.allowance(staker, Staking)
Approval      exact, 1 SAFE                sent only when the allowance is below the amount
Stake before  200 SAFE                     chain: Staking.stakes(staker, validator)

Transactions (2):
  1. SAFE token.approve(address spender, uint256 amount)
       to       <SAFE token address>
       spender  <Staking address>
       amount   1000000000000000000 (1 SAFE)
       gas      47,301 (eth_estimateGas)
       sent     no, dry run
  2. Staking.stake(address validator, uint256 amount)
       to         <Staking address>
       validator  <validator Gnosis>
       amount     1000000000000000000 (1 SAFE)
       gas        70,154 (eth_simulateV1, gas used after step 1; eth_estimateGas cannot see a step that is not sent)
       sent       no, dry run
```

```sh
safenet stake <validator address> 1 --dry-run --from <staker> --json
```

```json
{
  "operation": "stake",
  "dryRun": true,
  "from": "<staker>",
  "block": "26286989",
  "validator": "<validator Gnosis>",
  "amount": {
    "wei": "1000000000000000000",
    "safe": "1"
  },
  "balance": {
    "value": {
      "wei": "155474930438926870212",
      "safe": "155.474930438926870212"
    },
    "source": "chain: SAFE.balanceOf(staker)"
  },
  "allowance": {
    "value": {
      "wei": "0",
      "safe": "0"
    },
    "source": "chain: SAFE.allowance(staker, Staking)"
  },
  "approval": {
    "kind": "exact",
    "amount": {
      "wei": "1000000000000000000",
      "safe": "1"
    }
  },
  "stakeBefore": {
    "value": {
      "wei": "200000000000000000000",
      "safe": "200"
    },
    "source": "chain: Staking.stakes(staker, validator)"
  },
  "stakeAfter": null,
  "steps": [
    {
      "contract": "SAFE token",
      "to": "<SAFE token address>",
      "function": "approve(address spender, uint256 amount)",
      "args": {
        "spender": "<Staking address>",
        "amount": "1000000000000000000"
      },
      "data": "0x095ea7b3…",
      "gas": {
        "value": "47301",
        "source": "eth_estimateGas"
      },
      "transaction": null
    },
    {
      "contract": "Staking",
      "to": "<Staking address>",
      "function": "stake(address validator, uint256 amount)",
      "args": {
        "validator": "<validator Gnosis>",
        "amount": "1000000000000000000"
      },
      "data": "0xadc9772e…",
      "gas": {
        "value": "70154",
        "source": "eth_simulateV1, gas used after step 1; eth_estimateGas cannot see a step that is not sent"
      },
      "transaction": null
    }
  ]
}
```

### `safenet unstake <validator> <amount>`

Starts a withdrawal of SAFE staked on a validator with `initiateWithdrawal(validator, amount)`. The
SAFE becomes claimable after the contract's withdrawal delay; then run `safenet withdrawals claim`.

| Argument | What it is |
|---|---|
| `<validator>` | The validator's address |
| `<amount>` | SAFE to withdraw, such as `100` or `0.5` |

```sh
safenet unstake <validator address> 1 --dry-run --from <staker>
```

```text
Unstake 1 SAFE from validator <validator Gnosis>, from <staker>
Dry run against Ethereum Mainnet block 26,286,989: simulated and estimated, nothing signed or sent.

FIGURE         VALUE                 SOURCE
Stake before   200 SAFE              chain: Staking.stakes(staker, validator)
Withdrawal id  known once mined      the WithdrawalInitiated log of the transaction
Claimable at   2026-10-29 22:18 UTC  the read block's time plus Staking.withdrawDelay(), the earliest it can be

Transactions (1):
  1. Staking.initiateWithdrawal(address validator, uint256 amount)
       to         <Staking address>
       validator  <validator Gnosis>
       amount     1000000000000000000 (1 SAFE)
       gas        116,865 (eth_estimateGas)
       sent       no, dry run

The SAFE stays in the staking contract until the delay ends. Then run: safenet withdrawals claim --all
```

```sh
safenet unstake <validator address> 1 --dry-run --from <staker> --json
```

```json
{
  "operation": "unstake",
  "dryRun": true,
  "from": "<staker>",
  "block": "26286989",
  "validator": "<validator Gnosis>",
  "amount": {
    "wei": "1000000000000000000",
    "safe": "1"
  },
  "stakeBefore": {
    "value": {
      "wei": "200000000000000000000",
      "safe": "200"
    },
    "source": "chain: Staking.stakes(staker, validator)"
  },
  "stakeAfter": null,
  "withdrawal": {
    "id": null,
    "claimableAt": {
      "value": "2026-10-29T22:18:23.000Z",
      "source": "the read block's time plus Staking.withdrawDelay(), the earliest it can be"
    }
  },
  "steps": [
    {
      "contract": "Staking",
      "to": "<Staking address>",
      "function": "initiateWithdrawal(address validator, uint256 amount)",
      "args": {
        "validator": "<validator Gnosis>",
        "amount": "1000000000000000000"
      },
      "data": "0xc8393ba9…",
      "gas": {
        "value": "116865",
        "source": "eth_estimateGas"
      },
      "transaction": null
    }
  ]
}
```

### `safenet withdrawals claim [id]`

Claims withdrawals past their delay, with one `claimWithdrawal()` per withdrawal. The contract
function takes no id and pays the oldest first, so `<id>` claims every withdrawal up to and including
it. Only withdrawals past their delay are claimed; the others are named.

| Argument or option | What it is |
|---|---|
| `[id]` | Claim up to and including this withdrawal |
| `--all` | Claim every withdrawal past its delay |

Give `[id]` or `--all`, not both; with neither, it exits 2. The id is the withdrawal's id in the
staker's queue: the `ID` column below, and the `withdrawalId` of its `WithdrawalInitiated` log. It
is not the row number in the `#` column of `withdrawals list --address`.

```sh
safenet withdrawals claim --all --dry-run --from <staker>
```

```text
Claim every claimable withdrawal, from <staker>
Dry run against Ethereum Mainnet block 26,286,989: simulated and estimated, nothing signed or sent.

Queue before, oldest first, against the block time 2026-10-27 22:18 UTC (chain: Staking.withdrawalQueues(staker) and withdrawalNodes(staker, id)):
ID    AMOUNT  CLAIMABLE AT          THIS RUN
89  200 SAFE  2026-10-10 09:02 UTC  would claim

Would claim 1 withdrawal, 200 SAFE in total. claimWithdrawal() pays the oldest first.

Transactions (1):
  1. Staking.claimWithdrawal()
       to    <Staking address>
       gas   65,520 (eth_estimateGas)
       sent  no, dry run
```

```sh
safenet withdrawals claim --all --dry-run --from <staker> --json
```

```json
{
  "operation": "withdrawals claim",
  "dryRun": true,
  "from": "<staker>",
  "block": "26286990",
  "blockTime": "2026-10-27T22:18:35.000Z",
  "requested": "all",
  "queue": {
    "value": [
      {
        "id": "89",
        "amount": {
          "wei": "200000000000000000000",
          "safe": "200"
        },
        "claimableAt": "2026-10-10T09:02:59.000Z",
        "claimable": true
      }
    ],
    "source": "chain: Staking.withdrawalQueues(staker) and withdrawalNodes(staker, id)"
  },
  "claimed": [
    {
      "id": "89",
      "amount": {
        "wei": "200000000000000000000",
        "safe": "200"
      }
    }
  ],
  "total": {
    "wei": "200000000000000000000",
    "safe": "200"
  },
  "notYetClaimable": [],
  "steps": [
    {
      "contract": "Staking",
      "to": "<Staking address>",
      "function": "claimWithdrawal()",
      "args": {},
      "data": "0x6e66d84a…",
      "gas": {
        "value": "65520",
        "source": "eth_estimateGas"
      },
      "transaction": null
    }
  ]
}
```

### `safenet rewards claim`

Claims the signer's rewards with `claim()` on the MerkleDrop, using SEF's published proof for the
address. It claims only while the proof's root is the root on chain; otherwise it prints one sentence
and exits 1. It takes no argument besides the write options: the address is the signer's, or
`--from` in a dry run.

```sh
safenet rewards claim --dry-run --from <claimant>
```

```text
Claim rewards, from <claimant>
Dry run against Ethereum Mainnet block 26,286,990: simulated and estimated, nothing signed or sent.

FIGURE          VALUE                                                               SOURCE
Earned to date  1,793.986407841197543837 SAFE                                       SEF: the address's reward proof file, cumulativeAmount
Claimed before  218.56999494138645867 SAFE                                          chain: MerkleDrop.cumulativeClaimed(address)
Claimable       1,575.416412899811085167 SAFE                                       cumulativeAmount minus cumulativeClaimed
Merkle root     0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef  chain: MerkleDrop.merkleRoot(), equal to the proof's merkleRoot
Received        1,575.416412899811085167 SAFE                                       chain: SAFE Transfer logs from the MerkleDrop to the account in the simulated claim

Proof: <redacted-url> from SEF's repository, a mirror: rewards.safenet-gov.eth is set in a form this tool cannot read

Transactions (1):
  1. MerkleDrop.claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)
       to                  <MerkleDrop address>
       account             <claimant>
       cumulativeAmount    1793986407841197543837 (1,793.986407841197543837 SAFE)
       expectedMerkleRoot  0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef
       merkleProof         <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
       gas                 57,103 (eth_estimateGas)
       sent                no, dry run
```

```sh
safenet rewards claim --dry-run --from <claimant> --json
```

The `merkleProof` array is cut to its first two nodes here; the run returned eight.

```json
{
  "operation": "rewards claim",
  "dryRun": true,
  "from": "<claimant>",
  "block": "26286990",
  "claim": {
    "proofUrl": "<redacted-url>",
    "proofSource": {
      "kind": "repository",
      "url": "<redacted-url>",
      "gateway": null,
      "tried": [
        {
          "kind": "repository",
          "url": "<redacted-url>",
          "gateway": null,
          "outcome": "found",
          "reason": null
        }
      ],
      "ens": {
        "name": "rewards.safenet-gov.eth",
        "status": "unsupported",
        "contenthash": null,
        "reason": "the name is served by a parent's wildcard resolver"
      }
    },
    "merkleRoot": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "chain: MerkleDrop.merkleRoot(), equal to the proof's merkleRoot"
    },
    "cumulative": {
      "value": {
        "wei": "1793986407841197543837",
        "safe": "1793.986407841197543837"
      },
      "source": "SEF: the address's reward proof file, cumulativeAmount"
    },
    "claimedBefore": {
      "value": {
        "wei": "218569994941386458670",
        "safe": "218.56999494138645867"
      },
      "source": "chain: MerkleDrop.cumulativeClaimed(address)"
    },
    "claimable": {
      "value": {
        "wei": "1575416412899811085167",
        "safe": "1575.416412899811085167"
      },
      "source": "cumulativeAmount minus cumulativeClaimed"
    },
    "received": {
      "value": {
        "wei": "1575416412899811085167",
        "safe": "1575.416412899811085167"
      },
      "source": "chain: SAFE Transfer logs from the MerkleDrop to the account in the simulated claim"
    },
    "claimedAfter": null
  },
  "steps": [
    {
      "contract": "MerkleDrop",
      "to": "<MerkleDrop address>",
      "function": "claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)",
      "args": {
        "account": "<claimant>",
        "cumulativeAmount": "1793986407841197543837",
        "expectedMerkleRoot": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
        "merkleProof": [
          "<proof node>",
          "<proof node>"
        ]
      },
      "data": "0x1d7d4ebc…",
      "gas": {
        "value": "57103",
        "source": "eth_estimateGas"
      },
      "transaction": null
    }
  ]
}
```

An address with nothing left to claim exits 1:

```sh
safenet rewards claim --dry-run --from <staker>
```

```text
error: <staker> has already claimed all 102.208838566303287235 SAFE it has earned to date.
```

### `safenet rewards claim-and-stake <validator>`

Claims the signer's rewards, then approves if the allowance is short, then stakes on a validator,
one transaction after another. It stakes what the claim's SAFE `Transfer` log says arrived, or
`--amount`. An `--amount` above the claimable amount is refused before anything is sent. If the
claim pays less than `--amount`, what arrived is staked instead, with a line on stderr and
`cappedToReceived` in the result.

| Argument or option | What it is |
|---|---|
| `<validator>` | The validator's address |
| `--amount <amount>` | Stake this much SAFE and leave the rest in the wallet |
| `--approve <kind>` | When an approval is needed: `exact` (the default) or `unlimited` |

```sh
safenet rewards claim-and-stake <validator address> --dry-run --from <claimant>
```

```text
Claim rewards and stake them on validator <validator Gnosis>, from <claimant>
Dry run against Ethereum Mainnet block 26,286,990: simulated and estimated, nothing signed or sent.

FIGURE          VALUE                                                               SOURCE
Earned to date  1,793.986407841197543837 SAFE                                       SEF: the address's reward proof file, cumulativeAmount
Claimed before  218.56999494138645867 SAFE                                          chain: MerkleDrop.cumulativeClaimed(address)
Claimable       1,575.416412899811085167 SAFE                                       cumulativeAmount minus cumulativeClaimed
Merkle root     0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef  chain: MerkleDrop.merkleRoot(), equal to the proof's merkleRoot
Received        1,575.416412899811085167 SAFE                                       chain: SAFE Transfer logs from the MerkleDrop to the account in the simulated claim
Staked          1,575.416412899811085167 SAFE                                       what arrived
Allowance       0 SAFE                                                              chain: SAFE.allowance(staker, Staking)
Approval        exact, 1,575.416412899811085167 SAFE                                sent only when the allowance is below the amount
Stake before    25,030.052518890326755793 SAFE                                      chain: Staking.stakes(staker, validator)

Proof: <redacted-url> from SEF's repository, a mirror: rewards.safenet-gov.eth is set in a form this tool cannot read

Transactions (3):
  1. MerkleDrop.claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)
       to                  <MerkleDrop address>
       account             <claimant>
       cumulativeAmount    1793986407841197543837 (1,793.986407841197543837 SAFE)
       expectedMerkleRoot  0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef
       merkleProof         <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
                           <proof node>
       gas                 57,103 (eth_estimateGas)
       sent                no, dry run
  2. SAFE token.approve(address spender, uint256 amount)
       to       <SAFE token address>
       spender  <Staking address>
       amount   1575416412899811085167 (1,575.416412899811085167 SAFE)
       gas      46,953 (eth_simulateV1, gas used after step 1; eth_estimateGas cannot see a step that is not sent)
       sent     no, dry run
  3. Staking.stake(address validator, uint256 amount)
       to         <Staking address>
       validator  <validator Gnosis>
       amount     1575416412899811085167 (1,575.416412899811085167 SAFE)
       gas        70,190 (eth_simulateV1, gas used after steps 1, 2; eth_estimateGas cannot see a step that is not sent)
       sent       no, dry run
```

With `--amount 100` and `--json`. The `merkleProof` array is cut to its first two nodes here; the
run returned eight.

```sh
safenet rewards claim-and-stake <validator address> --amount 100 --dry-run --from <claimant> --json
```

```json
{
  "operation": "rewards claim-and-stake",
  "dryRun": true,
  "from": "<claimant>",
  "block": "26286990",
  "validator": "<validator Gnosis>",
  "claim": {
    "proofUrl": "<redacted-url>",
    "proofSource": {
      "kind": "repository",
      "url": "<redacted-url>",
      "gateway": null,
      "tried": [
        {
          "kind": "repository",
          "url": "<redacted-url>",
          "gateway": null,
          "outcome": "found",
          "reason": null
        }
      ],
      "ens": {
        "name": "rewards.safenet-gov.eth",
        "status": "unsupported",
        "contenthash": null,
        "reason": "the name is served by a parent's wildcard resolver"
      }
    },
    "merkleRoot": {
      "value": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
      "source": "chain: MerkleDrop.merkleRoot(), equal to the proof's merkleRoot"
    },
    "cumulative": {
      "value": {
        "wei": "1793986407841197543837",
        "safe": "1793.986407841197543837"
      },
      "source": "SEF: the address's reward proof file, cumulativeAmount"
    },
    "claimedBefore": {
      "value": {
        "wei": "218569994941386458670",
        "safe": "218.56999494138645867"
      },
      "source": "chain: MerkleDrop.cumulativeClaimed(address)"
    },
    "claimable": {
      "value": {
        "wei": "1575416412899811085167",
        "safe": "1575.416412899811085167"
      },
      "source": "cumulativeAmount minus cumulativeClaimed"
    },
    "received": {
      "value": {
        "wei": "1575416412899811085167",
        "safe": "1575.416412899811085167"
      },
      "source": "chain: SAFE Transfer logs from the MerkleDrop to the account in the simulated claim"
    },
    "claimedAfter": null
  },
  "requested": {
    "wei": "100000000000000000000",
    "safe": "100"
  },
  "staked": {
    "wei": "100000000000000000000",
    "safe": "100"
  },
  "cappedToReceived": false,
  "allowance": {
    "value": {
      "wei": "0",
      "safe": "0"
    },
    "source": "chain: SAFE.allowance(staker, Staking)"
  },
  "approval": {
    "kind": "exact",
    "amount": {
      "wei": "100000000000000000000",
      "safe": "100"
    }
  },
  "stakeBefore": {
    "value": {
      "wei": "25030052518890326755793",
      "safe": "25030.052518890326755793"
    },
    "source": "chain: Staking.stakes(staker, validator)"
  },
  "stakeAfter": null,
  "steps": [
    {
      "contract": "MerkleDrop",
      "to": "<MerkleDrop address>",
      "function": "claim(address account, uint256 cumulativeAmount, bytes32 expectedMerkleRoot, bytes32[] merkleProof)",
      "args": {
        "account": "<claimant>",
        "cumulativeAmount": "1793986407841197543837",
        "expectedMerkleRoot": "0x668901980a6c69b801f37cdef375059369dab712db8651a463d1d336b65cfdef",
        "merkleProof": [
          "<proof node>",
          "<proof node>"
        ]
      },
      "data": "0x1d7d4ebc…",
      "gas": {
        "value": "57103",
        "source": "eth_estimateGas"
      },
      "transaction": null
    },
    {
      "contract": "SAFE token",
      "to": "<SAFE token address>",
      "function": "approve(address spender, uint256 amount)",
      "args": {
        "spender": "<Staking address>",
        "amount": "100000000000000000000"
      },
      "data": "0x095ea7b3…",
      "gas": {
        "value": "46929",
        "source": "eth_simulateV1, gas used after step 1; eth_estimateGas cannot see a step that is not sent"
      },
      "transaction": null
    },
    {
      "contract": "Staking",
      "to": "<Staking address>",
      "function": "stake(address validator, uint256 amount)",
      "args": {
        "validator": "<validator Gnosis>",
        "amount": "100000000000000000000"
      },
      "data": "0xadc9772e…",
      "gas": {
        "value": "70166",
        "source": "eth_simulateV1, gas used after steps 1, 2; eth_estimateGas cannot see a step that is not sent"
      },
      "transaction": null
    }
  ]
}
```
