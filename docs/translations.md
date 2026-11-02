# Translations

The staking interface in `apps/web` ships in eight languages: English, Spanish, German, French,
Italian, Portuguese, Russian and Simplified Chinese. English is the source. Each other language
is one file of text, a catalogue, that anyone can correct or extend.

## Status of the catalogues

**The seven non-English catalogues are machine-translated and wait for review by native
speakers.** They use the terminology listed below. Until
a native speaker reviews a language, treat its text as a draft. Corrections are welcome; see
[Contributing a translation](#contributing-a-translation).

The catalogues cover the shell, Overview, My stake, validator list and details, Rewards,
Withdrawals, wallet controls, and the claim, approval, staking and withdrawal dialogs.
The staking review, contextual term explanations, access restrictions and wrong-network notices
also follow the selected language. Country names and waiting-period units use the browser's
locale formatters for that language.
Application-authored transaction messages, loading states, errors, tooltips and accessible
labels follow the selected language. Validator names, token symbols and addresses stay unchanged.
Wallet extensions and external provider/contract error strings are outside these catalogues.

## How it works

- `apps/web/src/i18n/locales/<code>.json` holds one catalogue per language. The codes are `en`,
  `es`, `de`, `fr`, `it`, `pt`, `ru` and `zh-Hans`.
- The source carries each text's key and its English, side by side:
  `t("overview.hero.title", "Network overview")`.
- `pnpm --filter @cobuilders/safenet-web i18n:extract` reads every key and its English from
  `apps/web/src` and writes `en.json`. Nobody edits `en.json` by hand.
- `pnpm --filter @cobuilders/safenet-web i18n:check` writes nothing. It fails when `en.json` is
  not what the source says, or when another catalogue misses a key, keeps a key the source no
  longer uses, leaves a text empty, or changes a placeholder or a tag. It also rejects raw JSX
  text and literal user-facing attributes outside a small allowlist of protocol units and
  proper names, even in files without an i18n import. This catches untranslated routes, not
  just missing catalogue entries. Runtime strings still need review. `pnpm check` runs it, so
  CI's `check` job fails on any of these.
- English is in the main bundle. Every other catalogue is its own file in the build, fetched
  from the same origin only when a reader chooses that language, so the interface works from
  static files on IPFS.
- The first visit follows the browser's preferred languages. A language chosen in the header is
  stored in `localStorage` under `language` and wins from then on. The document's `lang`
  attribute follows the language shown.
- Numbers and dates are not translated. Amounts, percentages and UTC dates use the same
  formatters in every language, so a figure reads the same everywhere: `12,345 SAFE`,
  `Tue 22 Sep 2026, 00:05 UTC`.
- Simplified Chinese uses the system's fonts. The app bundles no Chinese font.

## Contributing a translation

A contribution is a pull request that edits one catalogue, `apps/web/src/i18n/locales/<code>.json`.

1. Edit the text, never the key. Keys are the left-hand names, such as `"title"` under
   `"hero"`.
2. Keep every placeholder exactly as it is: `{{count}}`, `{{block}}`. Move it within the
   sentence as the grammar needs. Keep tags such as `<block>…</block>` around the same words.
3. Keep numbers, product names and proper names as they are: SAFE, Safenet, SEF, Beta, Aegis,
   MerkleDrop, Mainnet, Gnosis, Ethereum.
4. Use the terms in the table below, so one concept reads the same on every screen.
5. Run `pnpm --filter @cobuilders/safenet-web i18n:check`. It names any key you broke.
6. In the pull request, say which language you reviewed and whether you are a native speaker.

Plural texts have one key per plural form of the language, such as `_one` and `_other` in
English, and `_one`, `_few`, `_many` and `_other` in Russian. The check lists the forms each
language needs. A form may leave out `{{count}}` where the language says the number in words.

Texts about compliance, sanctions, region restrictions, risk or legal matters need a second
reviewer before they merge: `shell.accessRestricted.*`, `shell.walletRestricted.*`,
`footer.terms`, `footer.privacy`, `footer.imprint`, `programme.participationRule`,
`dashboard.complianceNote`, `dashboard.kycMayBeRequiredToClaimRewards`,
`rewards.sefHoldsThisPartOfYourRewardUntil`, and staking/withdrawal risk explanations.

## Terminology

| English | es | de | fr | it | pt | ru | zh-Hans |
|---|---|---|---|---|---|---|---|
| validator | validador | Validator | validateur | validatore | validador | валидатор | 验证者 |
| delegator | delegador | Delegator | délégateur | delegante | delegador | делегатор | 委托者 |
| stake (noun) | stake | Stake | stake | stake | stake | стейк | 质押 |
| stake (verb) | hacer staking | staken | staker | fare staking | fazer staking | застейкать | 质押 |
| staking | staking | Staking | staking | staking | staking | стейкинг | 质押 |
| claim | reclamar | beanspruchen | réclamer | riscattare | resgatar | востребовать | 领取 |
| withdrawal | retiro | Auszahlung | retrait | prelievo | saque | вывод | 提取 |
| withdrawn (validator) | retirado | ausgeschieden | retiré | ritirato | retirado | выбыл | 已退出 |
| rewards | recompensas | Belohnungen | récompenses | ricompense | recompensas | вознаграждения | 奖励 |
| programme | programa | Programm | programme | programma | programa | программа | 计划 |
| participation | participación | Teilnahme | participation | partecipazione | participação | участие | 参与率 |
| attestation | atestación | Attestierung | attestation | attestazione | atestação | аттестация | 证明 |
| subgraph | subgrafo | Subgraph | subgraph | subgraph | subgrafo | сабграф | 子图 |
| snapshot | instantánea | Momentaufnahme | instantané | istantanea | snapshot | снимок | 快照 |
| wallet | wallet | Wallet | portefeuille | wallet | carteira | кошелёк | 钱包 |

Use one consistent translation of unstake, cooldown and delegate throughout the transaction
dialogs. Distinguish leaving staking from claiming the tokens after the waiting period.

Portuguese is written in Brazilian Portuguese. Chinese covers Simplified script only: a browser
that asks for Traditional Chinese (`zh-TW`, `zh-HK`, `zh-Hant`) gets its next preferred language,
then English.

## Adding a language

1. Add the language to `LANGUAGES` in `apps/web/src/i18n/languages.ts`: its BCP 47 code and its
   own name, as its speakers write it. If browsers send tags the base code does not match, extend
   `matchLanguage` in the same file and its tests.
2. Copy `en.json` to `<code>.json` in `apps/web/src/i18n/locales/` and translate every text.
3. Run `i18n:check` until it passes. It requires each plural form the language uses.
4. Open all routes in the new language at a phone's width and at 1280 px. Add it to the
   route and transaction checks in `apps/web/e2e/tests/language-routes.spec.ts` and the
   Overview/header width checks in `apps/web/e2e/tests/language.spec.ts`.
5. Note in [Status of the catalogues](#status-of-the-catalogues) how the new catalogue was
   written and who reviewed it.

No other file changes: the build picks up every catalogue in `locales/`, and the header lists
every language in `LANGUAGES`.

## Adding or changing English text

Write the key and its English in the call, run `i18n:extract`, then add the key to every other
catalogue. `i18n:check` lists what is missing. A changed English text keeps its key only when the
meaning is the same; otherwise give it a new key, so a stale translation cannot survive.
