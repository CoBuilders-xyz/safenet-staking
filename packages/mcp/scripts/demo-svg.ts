/**
 * Renders a recorded MCP session as an animated SVG terminal: each call, then the summary the
 * server returned, appearing one after another. `scripts/demo.ts` records the session; this file
 * only lays it out, so a test can check it without a network.
 *
 * Every address is replaced by a label before it is drawn, every 32-byte value by `<hash>` and
 * every URL by `<redacted-url>`. Labels aid readability; public amounts and blocks can still
 * identify the accounts through chain records. This is not anonymization.
 */

export interface DemoStep {
  /** The call as the client sent it, such as `status {}`. */
  readonly call: string
  /** What came back: the summary text, and any lines drawn from the structured content. */
  readonly lines: readonly string[]
}

export interface DemoMeta {
  readonly title: string
  /** A line under the last step: where the session was recorded and with what. */
  readonly footer: string
}

const WIDTH = 980
const CHARS = 112
const LINE = 19
const TOP = 52
const PAD = 20
/** Seconds between a call and its answer, and between one step and the next. */
const ANSWER_DELAY = 0.7
const STEP_DELAY = 1.6

/** Labels for known addresses; any other address becomes `<address>`. */
export function redact(text: string, labels: ReadonlyMap<string, string>): string {
  return text
    .replace(/https?:\/\/[^\s"]+/gi, "<redacted-url>")
    .replace(/0x[0-9a-fA-F]{64}\b/g, "<hash>")
    .replace(/0x[0-9a-fA-F]{40}\b/g, (a) => labels.get(a.toLowerCase()) ?? "<address>")
}

/**
 * The label drawn for a validator's address. SEF's label is text from outside, and a replacement
 * is not scanned again, so the label is redacted before it becomes one.
 */
export function validatorLabel(label: string | null): string {
  return `<validator ${redact(label ?? "unlabelled", new Map())}>`
}

/** Breaks a line at spaces so none is longer than `width`; a word longer than that is cut. */
export function wrap(text: string, width: number = CHARS): string[] {
  const out: string[] = []
  let line = ""
  for (const word of text.split(" ")) {
    let w = word
    while (w.length > width) {
      if (line) out.push(line)
      out.push(w.slice(0, width))
      w = w.slice(width)
      line = ""
    }
    if (!line) line = w
    else if (line.length + 1 + w.length <= width) line += ` ${w}`
    else {
      out.push(line)
      line = w
    }
  }
  if (line) out.push(line)
  return out.length ? out : [""]
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

interface Row { readonly text: string; readonly kind: "call" | "answer" | "footer"; readonly at: number }

export function renderDemoSvg(steps: readonly DemoStep[], meta: DemoMeta): string {
  const rows: Row[] = []
  let at = 0.4
  for (const step of steps) {
    for (const [i, part] of wrap(`› ${step.call}`).entries()) rows.push({ text: i ? `  ${part}` : part, kind: "call", at })
    at += ANSWER_DELAY
    for (const line of step.lines) {
      for (const part of wrap(line, CHARS - 2)) rows.push({ text: `  ${part}`, kind: "answer", at })
    }
    rows.push({ text: "", kind: "answer", at })
    at += STEP_DELAY
  }
  for (const part of wrap(meta.footer)) rows.push({ text: part, kind: "footer", at })

  const height = TOP + rows.length * LINE + PAD
  const text = rows
    .map((r, i) => r.text
      ? `<text class="l ${r.kind}" x="${PAD}" y="${TOP + i * LINE}" style="animation-delay:${r.at.toFixed(1)}s">${escape(r.text)}</text>`
      : "")
    .filter(Boolean)
    .join("\n")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${escape(meta.title)}">
<title>${escape(meta.title)}</title>
<style>
.bg{fill:#0d1117}.bar{fill:#161b22}.dot{fill:#30363d}
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;white-space:pre}
.title{fill:#8b949e}.call{fill:#79c0ff}.answer{fill:#c9d1d9}.footer{fill:#8b949e}
.l{opacity:0;animation:show .25s ease-out forwards}
@keyframes show{to{opacity:1}}
@media (prefers-reduced-motion:reduce){.l{opacity:1;animation:none}}
</style>
<rect class="bg" width="${WIDTH}" height="${height}" rx="8"/>
<rect class="bar" width="${WIDTH}" height="30" rx="8"/>
<circle class="dot" cx="18" cy="15" r="5"/><circle class="dot" cx="36" cy="15" r="5"/><circle class="dot" cx="54" cy="15" r="5"/>
<text class="title" x="74" y="19">${escape(meta.title)}</text>
${text}
</svg>
`
}
