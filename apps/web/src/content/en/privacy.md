---
status: placeholder
---

# Privacy policy

Last updated: **[TODO: date of the final text]**

This policy describes the data flows of the Safenet Staking interface. The technical facts come from the source code. The legal sections are open and marked TODO.

## 1. Data controller

- Data controller: **[TODO: data controller, normally Backstage Online LLC]**
- Registered address: **[TODO: operator registered address]**
- Privacy contact: **[TODO: contact email]**

## 2. Summary

- The interface has no user accounts and asks for no name, email or password.
- The interface runs in your browser. The staking pages use no backend of the operator.
- Your browser sends requests directly to third-party services. Each service sees your IP address.
- A blockchain is public. Your wallet address and your transactions are visible to everyone, permanently.
- The optional alerts service is the only part that stores data about you on a server.

## 3. Country check (geoblock)

The interface refuses access from restricted countries. To do this, your browser looks up the country of your connection before the interface opens.

- The first lookup goes to `api.country.is`.
- If that lookup fails, a second lookup goes to `ipapi.co`.
- Each provider receives your IP address and the usual request headers. Each provider returns a two-letter country code.
- The interface stores the country code and the time of the lookup in your browser's local storage, under `geoblock_check`. The default storage time is 7 days. A deployment can change it with `VITE_GEOBLOCK_CACHE_DAYS`.
- During that time the interface makes no new lookup.
- The operator does not receive your IP address or the result.

## 4. Data stored in your browser

The interface sets no cookies of its own. It keeps this data in your browser's storage:

- `geoblock_check`: the country code and the lookup time, as above.
- `theme`: light or dark, after you change it.
- `language`: your language, after you choose one.
- Wallet connection state from the wallet library (keys that start with `wagmi`), such as the last wallet used.
- WalletConnect session data, only if you connect with WalletConnect.
- With browser notifications enabled: a service worker and the address of the alerts service.

You can delete this data in your browser settings at any time.

## 5. Requests your browser makes to third parties

Each service below receives your IP address and the content of the request. Their own privacy policies apply.

The providers named below are the defaults of the standard build. A deployment can configure other RPC, subgraph and IPFS providers. **[TODO: confirm the providers of this deployment]**

- **Ethereum RPC providers.** The interface reads the chain through public RPC endpoints. At the time of writing these are `ethereum-rpc.publicnode.com`, `eth.drpc.org` and `1rpc.io`. With a wallet connected, the requests contain your wallet address. This includes the read of the on-chain sanctions oracle for your address.
- **The Graph.** The interface reads indexed data from The Graph, through `gateway.thegraph.com` or `api.studio.thegraph.com`. The reward history query contains your wallet address.
- **SEF's published data.** The interface reads validator data and reward data that the Safe Ecosystem Foundation publishes on GitHub (`raw.githubusercontent.com`) and on IPFS. The IPFS gateways are `ipfs.orbitor.dev` and `ipfs.filebase.io` at the time of writing. The request for your reward proof contains your wallet address.
- **WalletConnect (Reown).** Only if you choose WalletConnect. The connection then goes through Reown's relay network.
- **Your wallet.** Your wallet software sends your transactions through its own providers. The interface does not control them.
- **Block explorers.** Only when you open an explorer link.
- **Hosting.** The provider that serves the interface files, for example an IPFS gateway, sees your IP address. **[TODO: name the hosting providers]**

## 6. Alerts service (optional)

A deployment can offer alerts by Telegram or by browser notification. The service applies only if the deployment offers it. It starts to process your data when you sign in to manage alerts, before you subscribe. It runs on Cloudflare Workers and stores its data in a Supabase database.

The service stores:

- Your wallet address.
- The sign-in challenge that you sign, until it expires.
- For each session: a hash of the session token, your wallet address, a hash of your signature and the expiry time. A session lasts 30 minutes.
- For each subscription: your wallet address, a hash of your signature, the triggers that you chose, your participation threshold, your missed-rounds threshold, the status, and the times of creation and last delivery.
- For browser notifications: the Web Push endpoint and the encryption keys that your browser created.
- For Telegram: the ID of the chat that you linked, and a hash of the one-time link token until you use it or it expires.
- For each alert sent: an event key, a hash of the receipt token, the delivery state, the number of attempts and the time.
- For each run of the service: the start time, the end time and counts. These records contain no wallet address and no endpoint. They are kept for 13 months.

Deletion:

- When you delete a subscription, the service deletes the subscription, its channel data and its delivery records.
- Sign-in challenges and sessions are not deleted with a subscription. They contain your wallet address. They are deleted automatically after they expire.

Recipients:

- Telegram receives the alert text for a Telegram subscription.
- Your browser's push service receives the encrypted notification for a browser subscription.
- Cloudflare and Supabase process the data as service providers. **[TODO: confirm processors, locations and agreements]**

The session token stays in your browser's memory only. It is gone when you disconnect, change wallet or close the page.

## 7. Analytics (only if enabled)

This build can send page views to Plausible Analytics, but only when a deployment sets `VITE_PLAUSIBLE_DOMAIN`. The standard build does not set it, so it sends no analytics. If a deployment enables it, Plausible receives the page address and your IP address for each page view.

## 8. Sanctions screening service (only if enabled)

This build can call a sanctions screening service on load, but only when a deployment sets `VITE_SANCTIONS_API_URL`. The standard build does not set it. If a deployment enables it, that service receives your IP address.

## 9. Legal bases and retention

**[TODO: legal bases for each purpose, retention periods, and international transfers]**

## 10. Your rights

**[TODO: rights of data subjects, how to exercise them, and the supervisory authority]**

## 11. Changes to this policy

**[TODO: how changes are published]**

## 12. Contact

**[TODO: contact email]**
