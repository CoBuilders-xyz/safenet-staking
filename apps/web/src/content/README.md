# In-app pages

The texts of four routes of the interface:

| File | Route |
|---|---|
| `en/imprint.md` | `/#/imprint` |
| `en/terms.md` | `/#/terms` |
| `en/privacy.md` | `/#/privacy` |
| `en/faq.md` | `/#/faq` |

`src/pages/ContentPage.tsx` renders them. To change a text, edit its file. No code changes.

## Status of the texts

The four texts are written from what the code does. A page shows no internal note: an open
point belongs in the pull request or the tracker, never in the text.

Each text opens with a "Last updated" line. Change the date with every change to the text.

To mark a text as not final, open its file with these lines:

```
---
status: placeholder
---
```

The page then shows the notice "Placeholder. The final text is pending legal review." No text
carries the lines today.

The privacy policy states data flows that come from the code. A test in
`src/pages/__tests__/ContentPage.test.tsx` fails when the policy does not name a host that
`packages/core` gives the browser. Keep those statements true when the text or the code changes.

The policy says that the published interface uses the default providers, with no analytics and
no sanctions screening service. A variable that sets a URL or a provider changes who receives
the requests: `VITE_RPC_URL` and its fallbacks, `VITE_SUBGRAPH_URL_MAINNET`,
`VITE_SUBGRAPH_URL_GNOSIS`, `VITE_GRAPH_API_KEY`, `VITE_IPFS_GATEWAY`, `VITE_REWARDS_BASE_URL`,
`VITE_VALIDATOR_INFO_URL`, `VITE_ALERTS_API_URL`, `VITE_SANCTIONS_API_URL`,
`VITE_PLAUSIBLE_DOMAIN` and `VITE_PLAUSIBLE_ENDPOINT`. The table of variables in
`apps/web/README.md` is the full list. The requests for reward proofs and to the alerts service
contain the wallet address. Before a deployment sets one of these variables, name its provider
in the policy. The policy also states the 7 days that `VITE_GEOBLOCK_CACHE_DAYS` defaults to.

## Supported Markdown

The renderer (`src/lib/markdown.ts`, `src/components/Markdown.tsx`) supports this subset. It
builds page elements directly and never inserts HTML.

- One `# Title` as the first line of the text, then `##`, `###` and `####` headings.
- Paragraphs, separated by an empty line.
- Lists with `-` or `1.`. Indent a list under an item to nest it. A numbered list keeps the
  number it starts with.
- `**bold**`, `*italic*` and `` `code` ``. Underscores do not mark italic.
- `> quote` and `---` for a rule.
- Links as `[label](address)`. The address is `https://...`, `http://...`, `mailto:...`, or a
  route of this app such as `#/terms`. Any other address is shown as text.
- `\` before a character shows that character as written.

Not supported: tables, images, HTML, code blocks, footnotes, reference links and line breaks
inside a paragraph. `src/content/__tests__/content.test.ts` fails with the file and the line when
a text uses one of them. To support more, extend the renderer and its tests first.

## Languages

The texts exist in English only. In another language the page shows the English text with a
translated note that says so. A translation needs its own files and a change in
`ContentPage.tsx` to select them.

## Another operator

`VITE_TERMS_URL`, `VITE_PRIVACY_URL` and `VITE_IMPRINT_URL` replace the in-app page in the footer
link and in the terms link on My stake. The operator's name is `OPERATOR_NAME` in
`src/config/legal.ts`.
