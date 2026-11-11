# Frequently asked questions

These answers describe what this interface does. For the rules of Safenet itself, see the [Safe Ecosystem Foundation's documentation](https://docs.safefoundation.org/safenet/) and its [FAQ](https://docs.safefoundation.org/safenet-aegis/resources/faqs).

## About this interface

### What is Safenet Staking?

Safenet Staking is an interface to the Safenet staking contracts on Ethereum Mainnet. You can read the state of the network, delegate SAFE to a validator, undelegate, and claim rewards.

### Who operates it?

Backstage Online LLC operates this interface. CoBuilders builds it. The [Imprint](#/imprint) has the details.

The Safe Ecosystem Foundation (SEF) publishes the Safenet contracts, the reward programme and the reward data. The operator of this interface does not control them.

### Do I need a wallet?

No, not to read. The Overview and the Validators pages work without a wallet. You need a wallet to delegate, undelegate or claim.

### Which wallets work?

- A browser wallet, such as an extension.
- WalletConnect.
- A Safe account, when you open the interface as a Safe App.

### Why can I not open the interface?

The interface refuses access from restricted countries and for wallet addresses on a sanctions list. It also refuses access when a check cannot give an answer. The [Privacy policy](#/privacy) describes the checks.

## Self-custody

### Does the interface hold my tokens?

No. Your SAFE stays in your wallet until you delegate. Delegated SAFE is in SEF's staking contract, not with the operator. The interface never sees your private keys.

### Can the operator move or return my tokens?

No. Only your wallet can sign a transaction for your tokens. The operator cannot reverse a transaction.

### What if this interface goes offline?

Your stake is in the staking contract on Ethereum. It does not depend on this interface. You can reach the contract with another interface or directly.

## Staking

### What does "delegate" mean?

To delegate is to stake your SAFE behind a validator that you choose. The interface says Delegate and Undelegate. The contract calls the same actions stake and withdraw.

### How do I delegate?

1. Connect your wallet.
2. Open Validators and choose a validator.
3. Enter an amount and review the summary.
4. Approve SAFE if your wallet asks, then confirm the stake.

### How do I get my SAFE back?

1. Undelegate the amount on the Validators page or on the My stake page.
2. Wait for the unstaking period. The Withdrawals page shows the time left.
3. Claim on the Withdrawals page. The SAFE then goes to your wallet.

Withdrawals are paid oldest first. During the unstaking period the SAFE earns no rewards and cannot be moved.

### Can I lose my staked SAFE?

SEF's documentation says that staked or delegated SAFE is not currently subject to slashing. A validator that performs badly costs rewards, not the SAFE itself. Smart contracts can still have defects. Read [SEF's documentation](https://docs.safefoundation.org/safenet/) for the current rules.

## Validators

### What is a validator?

A validator runs Safenet infrastructure and attests results. Your rewards follow the participation of the validator that you delegate to.

### What is the participation rate?

The participation rate shows how often a validator took part in Safenet's consensus. SEF sets a threshold for each reward period. Below it, the validator and its delegators earn nothing for that period. The interface shows the threshold beside each rate.

### What is commission?

Commission is the share of the rewards on delegated SAFE that the validator keeps. Delegators share the rest.

### Where do the validator figures come from?

- Stake, delegators and history come from the chain and from subgraphs that index it.
- Names, commission and the published participation rate come from SEF's published data.
- The interface names the source of its figures. When a source is late or fails, the interface says so and does not show the figure as current.

## Rewards

### How are rewards paid?

SEF pays rewards for each reward period through its distribution contract. Rewards are not added to your stake. You claim them on the Rewards page. A claim collects everything that you have not claimed yet.

SEF's [rewards documentation](https://docs.safefoundation.org/safenet-aegis/staking/rewards) has the rules.

### What is Claim & Stake?

Claim & Stake claims your rewards and then stakes the claimed SAFE with a validator that you choose. Rewards do not compound by themselves.

### Why is Claim disabled?

The interface compares the reward data with the root stored in the distribution contract. If they differ, the interface disables Claim until the data matches the chain.

### Are rewards guaranteed?

No. Rewards are not guaranteed and may vary.

## Alerts

### What are alerts?

Alerts are optional messages about your stake. A deployment of this interface can offer them or not. You can choose these triggers:

- A withdrawal is ready to claim.
- Rewards are claimable.
- Your validator was deregistered.
- Your validator's participation is below your threshold.
- Your validator missed a number of signing rounds in a row.

### How do I receive them?

By Telegram or by browser notification. You sign a message with your wallet to manage your subscriptions. The signature moves no funds and costs no fee.

### What does the alerts service store?

The service stores your wallet address, your choices and the delivery data for your channel. When you delete a subscription, the service deletes that subscription and its delivery data. Sign-in records contain your wallet address and are deleted after they expire. The [Privacy policy](#/privacy) has the full list.

## More

### In which languages is the interface available?

The interface is available in eight languages. The legal texts and this FAQ are in English only.

### Where can I read the terms?

See the [Terms of use](#/terms), the [Privacy policy](#/privacy) and the [Imprint](#/imprint).
