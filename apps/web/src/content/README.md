# In-app pages

The texts of four routes of the interface:

| File | Route |
|---|---|
| `en/imprint.md` | `/#/imprint` |
| `en/terms.md` | `/#/terms` |
| `en/privacy.md` | `/#/privacy` |
| `en/faq.md` | `/#/faq` |

`src/pages/ContentPage.tsx` renders them. To change a text, edit its file. No code changes.

## Placeholder status

The imprint, the terms and the privacy policy are placeholder text. Each of these files opens
with:

```
---
status: placeholder
---
```

While these lines are there, the page shows the notice "Placeholder. The final text is pending
legal review." Remove the three lines when the final text is in the file.

Each `[TODO: ...]` marks a detail that is still open, such as the registered address, the contact
email, the governing law and the data controller. Search for `TODO` to find them all.

The privacy policy states data flows that come from the code. A test in
`src/pages/__tests__/ContentPage.test.tsx` fails when the policy does not name a host that
`packages/core` gives the browser. Keep those statements true when the text changes.

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
