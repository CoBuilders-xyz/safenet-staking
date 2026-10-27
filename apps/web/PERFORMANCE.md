# Performance budget

The interface must load fast on a phone on a slow mobile connection. This file is the budget that
says how fast, why each number is what it is, and how it is enforced. The numbers live in
`performance-budget.json`; the checks read them from there.

## The budget

Lighthouse, mobile, its default settings: a mid-range phone with a CPU four times slower than a
desktop, on slow 4G (150 ms round trip, 1.6 Mbit/s down), simulated. Each route is measured three
times and the median is compared, because the page reads live data and single runs vary.

| Limit | Value | Why |
|---|---|---|
| Performance score | at least 80 | Lighthouse's own band for "good" starts at 90. 80 leaves room for the live data the page waits on, which a static site does not |
| Accessibility score | 100 | Nothing less is acceptable; `ACCESSIBILITY.md` covers what Lighthouse does not |
| Best practices, SEO | at least 95 | Both are at 100; a drop means a regression, not noise |
| First contentful paint | at most 2.0 s | Something must appear while the compliance checks answer |
| Largest contentful paint | at most 4.5 s | Every page waits for the location lookup before it may draw, by design, so the 2.5 s Web Vitals target is out of reach without weakening a gate |
| Total blocking time | at most 300 ms | The "good" threshold for a mid-range phone |
| Cumulative layout shift | at most 0.1 | The Web Vitals "good" threshold |

The bundle, gzipped, from a release build:

| Limit | Value | Why |
|---|---|---|
| Initial JavaScript | at most 200 KB | The entry script and its preloads, which download before anything draws. About 10% above today's size |
| Initial CSS | at most 12 KB | The one stylesheet |
| Largest chunk | at most 175 KB | WalletConnect's provider, loaded only when the user picks WalletConnect |
| Largest page chunk | at most 35 KB | The Overview, the heaviest page |

## How it is enforced

- `release:build` measures the bundle and fails a release over budget. The release workflow runs
  it on every tag.
- `pnpm --filter @cobuilders/safenet-web budget:bundle` runs the same check on any `dist/`.
- `pnpm --filter @cobuilders/safenet-web budget:lighthouse` serves `dist/` on loopback and runs
  Lighthouse against every route in the budget. It needs the network and a Chrome: `CHROME_PATH`,
  or Playwright's Chromium. Run it before a release and after any change to what loads first.

A limit is raised only with the measurement that justifies it, in the same change.

## What keeps it there

- WalletConnect loads when the user picks it, not on every visit
  (`src/config/walletConnect.ts`). Before, it was about 300 KB of every first paint.
- No manual chunk drags shared code into a chunk every page must load (`vite.config.ts`).
- The page of the URL opened starts loading alongside the compliance checks; the other pages
  preload three seconds after the page has loaded (`src/App.tsx`, `src/routes.ts`).
- The page-loading placeholder is a screen tall, and the subgraph freshness lines keep room for
  their answer, so content arriving does not push what is below it.

## Last measured

On 2026-10-27, release build, the median of three runs per route:

| Route | Performance | Accessibility | Best practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | 85 | 100 | 100 | 100 | 1.7 s | 4.3 s | 36 ms | 0.028 |
| `/#/dashboard` | 91 | 100 | 100 | 100 | 0.8 s | 3.5 s | 13 ms | 0.036 |
| `/#/validators` | 91 | 100 | 100 | 100 | 0.8 s | 3.5 s | 17 ms | 0 |
| `/#/withdrawals` | 92 | 100 | 100 | 100 | 1.7 s | 3.4 s | 0 ms | 0.029 |
| `/#/rewards` | 88 | 100 | 100 | 100 | 0.8 s | 3.9 s | 0 ms | 0 |

Bundle: initial JavaScript 180 KB, initial CSS 8 KB, largest chunk 159 KB (WalletConnect, on
demand), largest page chunk 24 KB (Overview).

The Overview is closest to a limit: its largest contentful paint varied between 3.5 s and 4.4 s
across runs on the same build, against 4.5 s. It reads the most live data before it draws.

Before this budget, the Overview measured 67 for performance, with a 7.0 s largest contentful
paint and a layout shift of 0.18: WalletConnect loaded on every first paint, and the footer and
the headline figures moved as data arrived.
