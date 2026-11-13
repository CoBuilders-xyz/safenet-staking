# Frequently asked questions

Last updated: 13 November 2026

These answers describe what this interface does. For the rules of Safenet itself, see the [Safe Ecosystem Foundation's documentation](https://docs.safefoundation.org/safenet/) and its [FAQ](https://docs.safefoundation.org/safenet-aegis/resources/faqs). The [Terms of use](#/terms) and the [Privacy policy](#/privacy) are the binding texts. If an answer here differs from them, they apply.

## About this interface

### What is Safenet Staking?

Safenet Staking is a non-custodial interface to the Safenet staking contracts on Ethereum Mainnet. You can read the state of the network, delegate SAFE to a validator, undelegate, and claim rewards. You sign every transaction with your own wallet.

### Who operates it?

Backstage Online LLC operates this interface. It is developed under the CoBuilders name. The [Imprint](#/imprint) has the address and the contact email.

The Safe Ecosystem Foundation (SEF) publishes the Safenet contracts, the reward programme and the reward data. The operator of this interface does not control them.

### Does it cost anything?

We charge no fee, and the interface adds no fee of ours to your transactions. You pay the Ethereum network fee for each transaction. A validator keeps its commission from the rewards, under the rules of the Safenet programme.

### Is this financial advice?

No. The interface shows public data and prepares the transactions that you ask for. It does not recommend a validator and it does not tell you whether to stake. You make your own decisions.

### Do I need a wallet?

No, not to read. The Overview and the Validators pages work without a wallet. You need a wallet to delegate, undelegate or claim. Before you connect one, the interface asks you to accept the [Terms of use](#/terms) and the [Privacy policy](#/privacy).

### Which wallets work?

- A browser wallet, such as an extension.
- WalletConnect.
- A Safe account, when you open the interface as a Safe App.

### Why can I not open the interface?

The interface refuses access from restricted countries and for wallet addresses on a sanctions list. It also refuses access when a check cannot give an answer, for example when a country lookup fails. In that case, reload the page later. The [Terms of use](#/terms) say who may use the interface, and the [Privacy policy](#/privacy) describes the checks. The legal pages and this FAQ open without the checks, so everyone can read them.

## Self-custody

### Does the interface hold my tokens?

No. Your SAFE stays in your wallet until you delegate. Delegated SAFE is in the Safenet staking contract on Ethereum, not with the operator. The interface never sees your private keys or your recovery phrase, and it never asks for them.

### Can the operator move or return my tokens?

No. Only your wallet can sign a transaction for your tokens. The operator cannot move, freeze or return them, and cannot reverse a transaction. Read each transaction in your wallet before you sign it.

### What if this interface goes offline?

Your stake is in the staking contract on Ethereum. It does not depend on this interface. You can reach the contract with another interface or directly.

## Staking

### What does "delegate" mean?

To delegate is to stake your SAFE behind a validator that you choose. The interface says Delegate and Undelegate. The contract calls these actions `stake` and `initiateWithdrawal`.

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

Staking has risks. SEF's documentation says that staked or delegated SAFE is not currently subject to slashing: a validator that performs badly costs rewards, not the SAFE itself. That rule can change. Smart contracts can have defects, and a defect can cause a loss. The [Terms of use](#/terms) list the risks. Read [SEF's documentation](https://docs.safefoundation.org/safenet/) for the current rules.

## Validators

### What is a validator?

A validator runs Safenet infrastructure and attests results. Your rewards follow the participation of the validator that you delegate to.

### What is the participation rate?

The participation rate shows how often a validator took part in Safenet's consensus. SEF sets a threshold for each reward period. Below it, the validator and its delegators earn nothing for that period. The interface shows the threshold beside each rate.

### What is commission?

Commission is the share of the rewards on delegated SAFE that the validator keeps. Delegators share the rest.

### Where do the validator figures come from?

- Stake, delegators and history come from the chain and from subgraphs that index it.
- A validator's name is its verified ENS name, where it has one.
- Commission and the published participation rate come from SEF's published data.
- The interface names the source of its figures. When it detects that a source is late or has failed, it says so.

## Rewards

### How are rewards paid?

SEF pays rewards for each reward period through its distribution contract. Rewards are not added to your stake. You claim them on the Rewards page. A claim collects everything that you have not claimed yet.

SEF's [rewards documentation](https://docs.safefoundation.org/safenet-aegis/staking/rewards) has the rules.

### What is Claim & Stake?

Claim & Stake claims your rewards and then stakes the claimed SAFE with a validator that you choose. Rewards do not compound by themselves.

### Why is Claim disabled?

The interface compares the reward data with the root stored in the distribution contract. If they differ, the interface disables Claim until the data matches the chain.

### Are rewards guaranteed?

No. Rewards are not guaranteed and may vary. If a validator's participation is below SEF's threshold in a reward period, its delegators earn nothing for that period.

### Is an estimated rate a promise?

No. Where the interface shows an estimated reward rate, such as an APR or an APY, it is an estimate from past or current data. It is not a forecast and not a guarantee. Actual rewards can be lower, or zero.

## Alerts

### What are alerts?

Alerts are optional messages about your stake. A deployment of this interface can offer them or not. You can choose these triggers:

- A withdrawal is ready to claim.
- Rewards are claimable.
- Your validator was deregistered.
- Your validator's participation is below your threshold.
- Your validator missed a number of signing rounds in a row.

### How do I receive them?

By Telegram or by browser notification. You sign a message with your wallet to manage your subscriptions. The signature moves no funds and costs no fee. Alerts can be late or can fail to arrive, so do not rely on them alone.

### What does the alerts service store?

The service stores your wallet address, your choices and the delivery data for your channel: a Telegram chat ID or a browser push subscription. When you delete a subscription, the service deletes that subscription and its delivery data. Sign-in records contain your wallet address and are deleted after they expire. The [Privacy policy](#/privacy) has the full list.

## Privacy

### What data does the interface collect about me?

The interface has no accounts and sets no cookies. It sends no analytics. Your browser talks directly to public services such as RPC providers, and those services see your IP address. So does the hosting provider that delivers the interface. The optional alerts service is the only part that keeps a database of user data. The operator also keeps the emails that you send. The [Privacy policy](#/privacy) has the details.

### Why does the interface look up my country?

To refuse access from restricted countries. Your browser asks a lookup service (`api.country.is`, then `ipapi.co`) for the country of your connection. The service sees your IP address. The legal pages and this FAQ do not start the lookup. Your browser keeps the country code for 7 days. The operator receives neither your IP address nor the result.

### How do I get my data deleted?

Delete your alert subscriptions on the Alerts page. For any other request, write to [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz). Nobody can delete what is recorded on a public blockchain.

## Command-line tool and MCP server

### What are they?

`safenet` is a command-line tool with the same operations as the interface. `safenet-mcp` is an MCP server that lets an AI agent or another MCP client run those operations. Both are open-source software that you run on your own computer.

### Do they send my private key anywhere?

No. A key or a keystore that you provide is used on your computer to sign, and the signed transaction is sent to the RPC endpoint. The key itself is not sent anywhere. The tools send no usage data to the operator.

### Can an AI agent move my funds through the MCP server?

Only if you allow it. Writes are dry runs unless you turn writes on and provide a signer when you start the server. If you do, the agent can send real transactions with that key, and you are responsible for them. Use a key that holds only what you are willing to risk.

## More

### In which languages is the interface available?

The interface is available in eight languages. The legal texts and this FAQ are in English only.

### Where can I read the terms?

See the [Terms of use](#/terms), the [Privacy policy](#/privacy) and the [Imprint](#/imprint).
