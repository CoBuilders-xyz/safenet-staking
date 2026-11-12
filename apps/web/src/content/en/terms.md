# Terms of use

Last updated: 12 November 2026

These terms are an agreement between you and Backstage Online LLC ("we", "us"). They govern your use of the Services described below. Read them before you use the Services. If you do not agree, do not use the Services.

## 1. Who we are

The Services are operated by **Backstage Online LLC**, 124 Broadkill Rd #636, Milton, Delaware 19968, United States. You can reach us at [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz). The [Imprint](#/imprint) has more details.

## 2. The Services

The "Services" are:

- **The interface.** The Safenet Staking web application, in every place where we publish it.
- **The command-line tool.** The `safenet` program, published as `@cobuilders/safenet-cli` and as standalone binaries.
- **The MCP server.** The `safenet-mcp` program, published as `@cobuilders/safenet-mcp`. It lets an AI agent or another MCP client run the same operations as the command-line tool.
- **The alerts service**, where a deployment offers it. It sends optional notifications about your stake.
- **The public data API**, where we offer it. It returns public validator and network data.

The Services read public data from Ethereum, Gnosis Chain and third parties. They help you prepare transactions for the Safenet staking contracts and the Safenet reward distribution contract. The Safe Ecosystem Foundation (SEF) publishes those contracts, the reward programme and the reward data. We do not.

## 3. The Services are non-custodial

- We never hold your SAFE or any other asset. We never have your private keys, your recovery phrase or your wallet password.
- You sign and send every transaction yourself, with your own wallet. In the command-line tool and the MCP server, the software that you run signs and sends with the key that you provide, on your instruction or on the instruction of the agent that you connect.
- Delegated SAFE is held by the Safenet staking contract on Ethereum, not by us.
- We cannot move, freeze, recover or return your assets. We cannot cancel or reverse a transaction.
- We are not a broker, an exchange, a custodian, a validator or a financial institution. We do not execute transactions for you and we cannot do so.

The command-line tool and the MCP server run on your own computer. When you give them a private key or a keystore, they use it on your computer to sign. They do not send it to us.

## 4. Who may use the Services

You may use the Services only if all of these statements are true:

- You are at least 18 years old and you have the legal capacity to accept these terms.
- You are not located in, and not a resident of, a country or territory on the restricted list of the interface, or one that is subject to comprehensive sanctions. The restricted list is part of the public source code, and the interface names your country when it refuses access for that reason.
- You are not on a sanctions list of the United States, the European Union, the United Kingdom or the United Nations. You are not owned or controlled by a person on such a list. You do not act for one.
- The use of the Services, and staking through them, is lawful where you are.

The interface applies access checks. It looks up the country of your connection and refuses access from the countries on its restricted list. It reads an on-chain sanctions oracle for the wallet address that you connect and refuses a listed address. It also refuses access when a check cannot give an answer. The command-line tool and the MCP server apply the on-chain check before every write, and the other checks when you enable them.

You must not get around these checks, for example with a VPN or a proxy. A check that lets you in is not a statement by us that your use is lawful. You remain responsible for that.

## 5. Your responsibilities

- Keep your wallet, your keys and your devices secure. We cannot restore access that you lose.
- Read every transaction in your wallet before you sign it. Check the contract, the validator, the amount and the network.
- Make your own decisions. Choose your validator yourself.
- Comply with the laws that apply to you. This includes tax. You are responsible for reporting and paying any tax that results from staking or rewards.
- Make sure that you use the real interface. Check the address before you connect a wallet.

You must not:

- use the Services for unlawful activity, such as money laundering, the financing of terrorism or the evasion of sanctions;
- attack, overload or disrupt the Services or the services they depend on;
- give false information to pass an access check;
- use the Services in a way that infringes the rights of another person.

## 6. No advice

Nothing in the Services is financial, investment, legal or tax advice. Nothing in the Services is an offer or a recommendation to buy, sell, stake or hold any asset. A list of validators and their figures is not a recommendation of any validator. We owe you no fiduciary duty.

## 7. Information and estimates

The Services show figures from public blockchains, from subgraphs that index them, and from data that SEF publishes. These sources can be late, incomplete, unavailable or wrong. The interface names the source of its figures and reports the failures and the delays that it detects. It does not detect every one. We do not guarantee any figure.

Where the Services show an estimated reward rate, such as an APR or an APY, that figure is an estimate only. It comes from past or current data and from assumptions. It is not a promise, a forecast or a guarantee of future rewards. Actual rewards can be lower, or zero.

Before you sign, the blockchain itself is the only reliable record. Verify important facts there.

## 8. Risks

Staking and blockchain software carry risk. You accept these risks when you use the Services:

- **Smart contract risk.** The Safenet contracts and the token contracts can contain defects. A defect can cause a total loss. We did not write these contracts and we do not control them.
- **Validator risk.** Your rewards depend on the validator that you delegate to. If its participation is below the threshold that SEF sets for a reward period, the validator and its delegators earn nothing for that period. A validator can stop operating or can be deregistered.
- **Reward risk.** Rewards are not guaranteed and may vary. SEF decides and publishes the reward distribution. SEF can change, pause or end the programme.
- **Slashing risk.** SEF's documentation states that staked or delegated SAFE is not currently subject to slashing. The rules of the protocol can change. If slashing applies, part of a stake can be taken as a penalty.
- **Unstaking delay.** After you undelegate, your SAFE waits in the staking contract for the unstaking period. During that time it earns no rewards and you cannot move it. The price of SAFE can change in that time.
- **Network risk.** Ethereum can be congested. Transactions can fail, can be delayed and can cost more than expected. Network fees are paid to the network, not to us, and are not refunded.
- **Market risk.** The value of SAFE and of rewards can fall, including to zero.
- **Software risk.** The Services can contain errors. They can show wrong data or prepare a transaction that does not do what you expect.
- **Third-party risk.** The Services depend on third parties that we do not control. See section 9.
- **Key and automation risk.** If you give a private key to the command-line tool or to the MCP server, any person or program that can run them can sign with it. An AI agent connected to the MCP server can make mistakes.
- **Regulatory risk.** Laws about digital assets and staking differ between countries and can change. A change can limit or end your ability to use the Services.
- **Phishing risk.** Other people can copy the interface. We never ask for your recovery phrase or your private key.

## 9. Third-party services

The Services depend on services that other parties operate. Examples are:

- the Ethereum and Gnosis Chain networks and the RPC providers that give access to them;
- The Graph, for indexed data;
- GitHub, IPFS gateways and the Ethereum Name Service, for the data that SEF publishes;
- WalletConnect (Reown), browser wallets and Safe, for the connection to your wallet;
- country lookup services, for the country check;
- hosting providers, such as Vercel, Cloudflare and IPFS pinning and gateway services;
- Telegram and browser push services, for alerts.

We do not control these services and we are not responsible for them. Their own terms and privacy policies apply to your use of them. If one of them fails, changes or stops, the Services can fail or show wrong data. The [Privacy policy](#/privacy) describes what data they receive.

## 10. The command-line tool and the MCP server

- The command-line tool and the MCP server are open-source software under the MIT licence. That licence governs your right to use, copy and change the software. Its disclaimer of warranty applies together with these terms.
- You run them on your own computer and at your own risk. You choose the RPC endpoint and the other settings.
- A dry run signs nothing and broadcasts no transaction. It still makes network requests, for example to simulate the transaction. A live write sends real transactions that cannot be reversed.
- In the MCP server, writes are dry runs unless you turn writes on when you start the server. If you turn them on, you authorise the connected agent or client to send transactions with the key that you provide. You are responsible for everything that the agent or client does.
- Protect the key that you provide. Prefer a keystore file or an external signer to a key in an environment variable. Use a key that holds only what you are willing to risk.

## 11. Alerts

The alerts service is optional and is provided on a best-effort basis. An alert can be late, can be wrong or can fail to arrive. Do not rely on alerts as your only way to follow your stake, your withdrawals or your rewards. An alert never moves funds and never asks you to sign a transaction.

## 12. Fees

We do not charge a fee for the Services at present, and the interface adds no fee of ours to your transactions. You pay the network fees for your transactions. A validator's commission is set under the rules of the Safenet programme and is not paid to us. If we introduce a fee, we will state it in these terms before it applies.

## 13. Intellectual property

The source code of the Services is available under the MIT licence. These terms do not limit that licence.

The names, logos and marks of third parties, including Safe and Safenet, belong to their owners. Their use in the Services identifies the protocol that the Services work with. It does not mean that those owners operate or endorse the Services.

## 14. Availability and changes

We can change, suspend, restrict or end any part of the Services at any time and without notice. We can refuse access where the law or our access checks require it. We do not promise that the Services will be available, complete or free of errors.

The Safenet contracts stay reachable without the Services. If the Services are not available, you can use another interface or interact with the contracts directly.

## 15. Disclaimer of warranties

**To the fullest extent that the law allows, the Services are provided "as is" and "as available", without warranty of any kind, whether express, implied or statutory. We disclaim all implied warranties, including warranties of merchantability, fitness for a particular purpose, title, non-infringement, accuracy and uninterrupted or error-free operation.**

We give no warranty about the Safenet protocol, any validator, any reward, any blockchain, or any third-party service or data.

## 16. Limitation of liability

**To the fullest extent that the law allows, Backstage Online LLC and its members, managers, employees, contractors and contributors are not liable for any indirect, incidental, special, consequential, exemplary or punitive damages, or for any loss of profits, revenue, data, goodwill, digital assets or rewards, that arises from or relates to the Services or these terms. This applies to every legal theory and even if we were told that the damage was possible.**

**To the fullest extent that the law allows, our total liability for all claims that arise from or relate to the Services or these terms is limited to the greater of (a) the amount that you paid to us for the Services in the 12 months before the claim arose and (b) 100 US dollars.**

In particular, we are not liable for loss that results from:

- your decisions, your transactions or your errors;
- the loss, theft or misuse of your keys, your wallet or your devices;
- defects or changes in the Safenet contracts, the reward programme or any blockchain;
- the conduct or performance of a validator, of SEF or of another third party;
- wrong, late or missing data, estimates or alerts;
- the failure, change or end of a third-party service;
- the actions of an agent or client that you connect to the MCP server;
- access restrictions that the law or our access checks require.

Nothing in these terms excludes or limits liability for fraud, for wilful misconduct, for gross negligence, or for death or personal injury caused by negligence, where the law does not allow that exclusion or limit. Some laws do not allow some of the other limits in this section. In that case those limits apply only as far as the law allows. Nothing in these terms removes rights that you have as a consumer under mandatory law.

## 17. Indemnity

To the extent that the law allows, and except where you act as a consumer and mandatory law forbids it, you will indemnify Backstage Online LLC and its members, managers, employees, contractors and contributors against claims, losses and costs, including reasonable legal fees, that result from your breach of these terms, your breach of a law or your infringement of the rights of another person.

## 18. Governing law and jurisdiction

**This section is to be confirmed by counsel.** The laws of the State of Delaware, United States, govern these terms and any dispute that arises from them or from the Services, without regard to conflict-of-law rules. The state and federal courts located in the State of Delaware have exclusive jurisdiction over such disputes, and you and we accept the jurisdiction of those courts.

If you are a consumer, mandatory law of your country of residence can give you the right to bring a claim in your own courts and under your own law. These terms do not take that right away.

## 19. Changes to these terms

We can change these terms. We publish the new version in the interface and change the "Last updated" date at the top. The new version applies to your use of the Services after we publish it. If you do not agree with a change, stop using the Services. A version of the interface that was published earlier, for example on IPFS, can still show an older text. Our current release shows the current terms.

## 20. General

- **Entire agreement.** These terms and the open-source licence are the whole agreement between you and us about the Services. The [Privacy policy](#/privacy) explains how personal data is processed. It is a notice and not part of this agreement.
- **Severability.** If a court finds that a part of these terms is invalid, the other parts stay in force.
- **No waiver.** If we do not enforce a right, we do not give it up.
- **Assignment.** You may not transfer your rights under these terms without our consent. We may transfer ours to a successor or an affiliate.
- **No partnership.** These terms create no partnership, agency or employment between you and us.
- **Language.** These terms are written in English. If a translation differs from the English text, the English text applies.

## 21. Contact

Backstage Online LLC, 124 Broadkill Rd #636, Milton, Delaware 19968, United States.

Email: [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz)
