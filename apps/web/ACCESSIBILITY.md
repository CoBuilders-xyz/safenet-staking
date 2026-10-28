# Accessibility

The interface targets WCAG 2.2 level AA, the international standard for web accessibility, for
people with visual or motor impairments. This file says what is checked, how, and what is left
to a person.

## What a machine checks

`e2e/tests/accessibility.spec.ts` runs axe-core against WCAG 2.0, 2.1 and 2.2, levels A and AA
(the tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`). It is part of
`pnpm --filter @cobuilders/safenet-web test:e2e`, so it runs on every pull request. A serious or
critical violation fails the test. Each run prints one line per page, which is the report.

It covers:

- every route, with no wallet and with a wallet, in the light theme;
- every route with a wallet in the dark theme;
- the Wrong network notice, the restricted screen, the delegate dialog, its "what happens if"
  step, and a term's explanation while it is open.

axe finds about a third of WCAG failures: the ones a rule can decide, such as contrast, names,
roles, labels and target size. The rest needs a person.

## What the interface does for it

- **Contrast.** axe finds no text below 4.5:1, or large text below 3:1, on any page it audits, in
  either theme. The colours are tokens in `src/index.css`; the light theme's green was darkened
  to reach 4.5:1 on its own tinted badge.
- **Keyboard.** Every action is a button or a link. Dialogs trap focus and close on Escape. A
  term's explanation opens on focus and closes on Escape.
- **Touch.** A term's explanation opens on a tap, not only on hover, because a tooltip alone never
  opens on a touch screen. Screens that show a participation rate also state the reward rule as
  text.
- **Screen readers.** The Overview and Rewards sections, the Wrong network notice and the
  "what happens if" step are labelled regions. Loading placeholders that carry a
  label are announced as a status; the others are hidden from assistive technology. Errors are
  alerts. The restricted screen names the gate that closed the interface in text, not by colour.
- **Motion.** Under `prefers-reduced-motion`, nothing animates, spinners included
  (`src/index.css`).

## What a person checks

Before a release, follow the accessibility section of `MANUAL_TESTING.md`: the whole interface
by keyboard alone, with VoiceOver or NVDA, at 200% zoom, and on a phone.
