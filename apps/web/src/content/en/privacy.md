# Privacy policy

Last updated: 12 November 2026

This policy explains what personal data is processed when you use Safenet Staking, why, and what your rights are. It covers the web interface, the alerts service, the public data API, the command-line tool (`safenet`) and the MCP server (`safenet-mcp`). Together they are the "Services".

## 1. Who is responsible

**Backstage Online LLC**, 124 Broadkill Rd #636, Milton, Delaware 19968, United States, operates the Services and is responsible for the personal data that it processes, as described in this policy.

Contact for every privacy question and request: [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz)

## 2. Summary

- The Services have no user accounts. We ask for no name, no email address and no password.
- The interface runs in your browser. Apart from the hosting that delivers its files, the staking pages use no server of ours. Your browser talks directly to third-party services, and each of them sees your IP address.
- We set no cookies. We run no analytics and no advertising. We do not sell personal data.
- A blockchain is public. Your wallet address and your transactions are visible to everyone, permanently. Nobody can delete them.
- The optional alerts service is the only part of the Services that keeps a database of user data. You can delete your subscriptions yourself at any time. Apart from that, we keep the emails that you send us, and our hosting providers process the technical data of requests.
- The command-line tool and the MCP server run on your computer. They send no data to us.

## 3. Country check

The interface refuses access from the countries on our restricted list. The list is part of the public source code. To apply it, your browser looks up the country of your connection before the interface opens. The imprint, the terms of use, this policy and the FAQ open without this lookup, so you can read them first.

- **What is sent.** Your browser sends a request to `api.country.is`. If that request fails, it sends a request to `ipapi.co`. Each provider receives your IP address and the usual technical data of a web request, such as your browser type. The request contains no wallet address and no other identifier from us.
- **What comes back.** A two-letter country code.
- **What is stored.** Your browser stores the country code and the time of the lookup in its local storage, under the key `geoblock_check`, for 7 days. During that time it makes no new lookup. After that time the next visit makes a new lookup.
- **What we receive.** Nothing. The lookup happens between your browser and the provider. We do not receive, log or store your IP address or the result.
- **Why.** To limit the Services to the places where we choose to offer them, which includes our effort to respect sanctions rules.

We chose these two providers, and our code makes your browser contact them. Each provider processes your IP address under its own privacy policy. We do not know how long they keep it.

If you turn on the optional country check in the command-line tool or the MCP server, your computer sends the same requests.

## 4. Data stored in your browser

The interface sets no cookies. It keeps this data in your browser's storage:

- `geoblock_check`: the country code and the lookup time, as described above.
- `theme`: light or dark, after you change it.
- `language`: your language, after you choose one.
- Wallet connection state from the wallet library, under keys that start with `wagmi`. It holds, for example, the last wallet that you used.
- WalletConnect session data, only if you connect with WalletConnect.
- If you enable browser notifications for alerts: a service worker and the address of the alerts service.

This data stays on your device. We cannot read it. You can delete it in your browser settings at any time.

## 5. Services that your browser contacts

To show data and to prepare transactions, your browser sends requests directly to the services below. Each service receives your IP address, the technical data of the request and the content of the request. We do not receive these requests. Each service processes the data under its own privacy policy.

**Providers of this deployment.** The interface that we publish uses the providers named in this section. It is built with the default settings of the public source code. It does not enable analytics or the separate sanctions screening service that the source code supports (see section 10). If we configure a different provider for RPC, indexed data, reward data or IPFS, we will name it here before we use it.

- **Ethereum RPC providers.** The interface reads the chain through public RPC endpoints: `ethereum-rpc.publicnode.com`, `eth.drpc.org` and `1rpc.io`. When a wallet is connected, the requests contain your wallet address. One of these requests asks an on-chain sanctions oracle whether your address is listed.
- **The Graph.** The interface reads indexed data through The Graph's gateway, `gateway.thegraph.com`. It uses `api.studio.thegraph.com` when the gateway is not configured or fails. Most queries contain no personal data. The query for your reward history contains your wallet address.
- **SEF's published data.** The interface reads validator data and reward data that the Safe Ecosystem Foundation publishes on GitHub (`raw.githubusercontent.com`) and on IPFS, through the gateways `ipfs.orbitor.dev` and `ipfs.filebase.io`. The request for your reward proof contains your wallet address.
- **WalletConnect (Reown).** Only if you choose WalletConnect. The connection between the interface and your wallet then goes through Reown's relay network.
- **Your wallet.** Your wallet software sends your transactions through its own providers. We do not choose or control them.
- **Safe.** If you open the interface as a Safe App, it runs inside the Safe wallet interface and exchanges messages with it.
- **Block explorers.** Only when you open an explorer link.
- **Hosting.** The provider that delivers the files of the interface sees your IP address and the technical data of the request. Vercel delivers the interface for us. We also publish the interface on IPFS, where Pinata pins it and Pinata's gateway or a public IPFS gateway delivers it.

## 6. Wallet and blockchain data

The interface reads the wallet address that you connect. It uses it to show your balances, your stake, your withdrawals and your rewards, and to prepare the transactions that you ask for. This happens in your browser. We do not receive or store your wallet address when you use the staking pages.

Transactions that you sign are recorded on a public blockchain. We do not control the blockchain. We cannot change or delete what is recorded there.

## 7. Alerts service

Alerts are optional. The service applies only where a deployment offers it. It starts to process your data when you sign in to manage alerts, before you subscribe. It runs on Cloudflare Workers and stores its data in a Supabase database.

### What the service stores

- **To sign you in:** your wallet address and the sign-in message that you sign. The message is valid for 5 minutes and is deleted after it expires.
- **For each session:** a hash of the session token, your wallet address, a hash of your signature and the expiry time. A session lasts 30 minutes. The session token itself stays in your browser's memory and is gone when you disconnect, change wallet or close the page.
- **For each subscription:** your wallet address, a hash of your signature, the triggers that you chose, your participation threshold, your missed-rounds threshold, the delivery channel, the status, the time of creation and the time of the last confirmed delivery.
- **For browser notifications:** the Web Push subscription that your browser created. It is an endpoint address at your browser's push service and two encryption keys.
- **For Telegram:** the ID of the private chat that you linked. Before you link it, the service keeps a hash of a one-time link token for 10 minutes. The service does not store your Telegram name or your messages.
- **For each alert sent:** a key that identifies the event, so that the same alert is not sent twice; the delivery state; the number of attempts; the time; and, for 24 hours, a hash of a receipt token.
- **For each run of the service:** the start time, the end time and counts of alerts. These records contain no wallet address and no delivery address.

The service also reads public blockchain data about your stake to decide when to alert you.

### Why

To send you the alerts that you asked for, to prove that a subscription belongs to the wallet that created it, to prevent duplicate alerts and abuse, and to monitor that the service works.

### How long

- Sign-in messages and sessions: until they expire. Then they are deleted automatically.
- Subscriptions, delivery channels and delivery records: until you delete the subscription. The service does not delete a subscription by itself. This includes a subscription whose delivery channel has stopped working.
- Run records: 13 months.

### How to delete

Open the Alerts page, sign in and choose "Delete subscription". The service then deletes the subscription, its delivery channel and its delivery records. You can also write to [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz).

### Who receives the data

- **Cloudflare** runs the service and **Supabase** hosts its database. They process the data for us. Cloudflare also processes your IP address and the technical data of each request that your browser sends to the service.
- **Telegram** receives the alert text and the chat ID for a Telegram subscription.
- **Your browser's push service**, for example the one of Google, Mozilla, Apple or Microsoft, receives the encrypted notification for a browser subscription. It cannot read the content.
- The service reads public data through RPC providers, The Graph, GitHub and IPFS gateways. Some of these requests contain your wallet address.

## 8. Public data API

Where we offer the public data API, it returns public validator and network data. It has no accounts and receives no wallet connection. It runs on Cloudflare Workers.

- Cloudflare processes your IP address and the technical data of each request to deliver the response and to protect the service. Cloudflare's logging is enabled for the API, so Cloudflare can keep request logs. Query strings are removed from them.
- Our own application logs record the type of route, the duration and, for a failure, an error code. They do not record your IP address.
- A request can contain an Ethereum address in its path. The API answers for validator addresses only.

## 9. Command-line tool and MCP server

The command-line tool and the MCP server run on your computer.

- They send no usage data, no telemetry and no error reports to us.
- A private key, a keystore file or a keystore password that you provide is used on your computer only. It is never sent to us or to any other service. The signed transaction is sent to the RPC endpoint.
- They send requests from your computer to the RPC endpoint that you configure, or to the public default endpoints `ethereum-rpc.publicnode.com` and `eth.llamarpc.com`. They also send requests to The Graph, to GitHub and to IPFS gateways. Those services see your IP address and the content of each request. This includes the addresses that you query and, for a write or a dry run, the transaction that is simulated.
- If you enable them, the country check and a sanctions endpoint that you configure also receive a request from your computer.
- If you use WalletConnect, the connection to your wallet, including each transaction request, goes through Reown's relay network.
- When you download or install the software, the registry or the website that you download from sees your IP address.

## 10. Cookies and analytics

- **Cookies.** The interface sets no cookies.
- **Analytics.** The interface that we publish sends no analytics. The source code can send page views to Plausible Analytics, but only when a deployment sets `VITE_PLAUSIBLE_DOMAIN`. We do not set it. If we enable it, we will update this policy first. Plausible would then receive the page address and your IP address for each page view.
- **Sanctions screening service.** The source code can call an additional sanctions screening service on load, but only when a deployment sets `VITE_SANCTIONS_API_URL`. We do not set it. If we enable it, we will update this policy first. That service would then receive your IP address.
- **Advertising and tracking.** None.

## 11. When you contact us

If you write to us, we process your email address and the content of your message to answer you. We keep the correspondence for as long as we need it to handle your request and to keep a record of it.

## 12. Purposes and legal bases

Where the EU or UK General Data Protection Regulation (GDPR) or a similar law applies, we rely on these legal bases:

- **Country check and sanctions checks:** our legitimate interest in limiting where and to whom we offer the Services and in respecting sanctions rules; and compliance with legal obligations, where they apply to us.
- **Delivery of the interface and the API:** our legitimate interest in providing the Services through hosting providers.
- **Alerts:** the performance of the service that you request when you subscribe; and your consent for browser notifications, which you give in your browser and can withdraw there.
- **Security, abuse prevention and service monitoring:** our legitimate interest in running a secure and reliable service.
- **Correspondence and legal claims:** our legitimate interest in answering you and in establishing, exercising or defending legal claims; and compliance with legal obligations.

The access checks are automatic and no person reviews them. If a check refuses you and you think that this is an error, write to us and a person will look at it.

We do not use personal data for profiling or for marketing.

## 13. Sharing and international transfers

We share personal data only with the service providers named in this policy, and with authorities or other parties when the law requires it or when it is necessary to establish, exercise or defend legal claims. We do not sell personal data and we do not share it for advertising.

We are based in the United States. Our service providers process data in the United States and in other countries. If you are in the European Economic Area, the United Kingdom or Switzerland, your data is therefore transferred to countries whose data protection laws differ from yours. Write to us if you want information about the safeguards that apply to these transfers.

## 14. Your rights

Depending on where you live, you have some or all of these rights over the personal data that we hold about you:

- to know whether we process your data and to receive a copy of it;
- to have wrong data corrected;
- to have your data deleted;
- to restrict or object to our processing;
- to receive your data in a portable format;
- to withdraw a consent at any time, without effect on earlier processing;
- to complain to the data protection authority of your country.

To use a right, write to [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz). We answer within the time that the law sets, normally within one month. We do not charge for a request and we do not treat you differently because you made one.

Because we have no accounts, we identify you by your wallet address. To protect your data, we can ask you to prove that you control the wallet, for example by signing a message.

Some limits apply:

- You can delete your alert subscriptions yourself at any time, as described in section 7.
- We cannot delete or change data on a public blockchain.
- For data that our service providers process for us, such as hosting and the alerts infrastructure, write to us.
- Independent services that your browser or your computer contacts directly, such as RPC providers, The Graph, GitHub, IPFS gateways, the country lookup services and WalletConnect, decide themselves how they process your data. We do not hold that data. For it, contact the service concerned.

## 15. Security

The alerts service stores session tokens, link tokens and receipt tokens as hashes only. Its database accepts requests from the service only, not from browsers. No system is completely secure, and we cannot guarantee the security of data.

## 16. Children

The Services are not directed to people under 18, and we do not knowingly process their data. If you believe that a child has used the alerts service, write to us and we will delete the data.

## 17. Changes to this policy

We can change this policy. We publish the new version in the interface and change the "Last updated" date at the top. We update this policy before we change a provider or enable a feature that changes who receives your data. A version of the interface that was published earlier, for example on IPFS, can still show an older text.

## 18. Contact

Backstage Online LLC, 124 Broadkill Rd #636, Milton, Delaware 19968, United States.

Email: [contact@cobuilders.xyz](mailto:contact@cobuilders.xyz)
