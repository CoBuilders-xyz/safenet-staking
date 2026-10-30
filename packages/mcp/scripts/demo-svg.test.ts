import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { numberToHex, pad } from "viem"
import { redact, renderDemoSvg, validatorLabel, wrap } from "./demo-svg.js"

// The demo's layout and its redaction, without a network. scripts/demo.ts records the session.

const address = (n: number) => pad(numberToHex(n), { size: 20 })
const hash = pad(numberToHex(7), { size: 32 })

test("redact turns known addresses into their labels, others into <address>, hashes and URLs into placeholders", () => {
  const labels = new Map([[address(5).toLowerCase(), "<staker>"]])
  const text = `from ${address(5).toUpperCase().replace("0X", "0x")} to ${address(6)}, tx ${hash}, at https://rpc.invalid/key`
  assert.equal(redact(text, labels), "from <staker> to <address>, tx <hash>, at <redacted-url>")
})

test("a validator's label is redacted before it replaces an address, since a replacement is not scanned again", () => {
  assert.equal(validatorLabel("Gnosis"), "<validator Gnosis>")
  assert.equal(validatorLabel(null), "<validator unlabelled>")
  const labels = new Map([[address(9).toLowerCase(), validatorLabel(`Ops ${address(5)} https://ops.invalid/key ${hash}`)]])
  assert.equal(redact(`stake on ${address(9)}`, labels), "stake on <validator Ops <address> <redacted-url> <hash>>")
})

test("mixed-case credential-bearing URLs stay out of demo text and validator labels", () => {
  const input = "HTTPS://user:fixture-password@rpc.invalid/?key=fixture-token"
  assert.equal(redact(input, new Map()), "<redacted-url>")
  assert.equal(validatorLabel(input), "<validator <redacted-url>>")
})

test("wrap breaks at spaces within the width, and cuts a word longer than it", () => {
  assert.deepEqual(wrap("one two three four", 9), ["one two", "three", "four"])
  assert.deepEqual(wrap("abcdefghij kl", 4), ["abcd", "efgh", "ij", "kl"])
  assert.deepEqual(wrap("", 10), [""])
})

test("the SVG draws each call before its answer, escapes the text, and carries no address", () => {
  const svg = renderDemoSvg(
    [
      { call: "status {}", lines: ["Safenet at block 1 & <more>"] },
      { call: "validators_list {}", lines: ["4 validators"] },
    ],
    { title: 'a <title> "quoted"', footer: "Recorded here." },
  )
  assert.match(svg, /^<svg xmlns=/)
  assert.match(svg, /<title>a &lt;title&gt; &quot;quoted&quot;<\/title>/)
  assert.match(svg, /aria-label="a &lt;title&gt; &quot;quoted&quot;"/)
  assert.match(svg, /> {2}Safenet at block 1 &amp; &lt;more&gt;<\/text>/)
  const delays = [...svg.matchAll(/style="animation-delay:([\d.]+)s">([^<]*)</g)].map((m) => [Number(m[1]), m[2] ?? ""] as const)
  const at = (text: string) => delays.find(([, t]) => t.includes(text))![0]
  assert.ok(at("› status") < at("Safenet at block 1"))
  assert.ok(at("Safenet at block 1") < at("› validators_list"))
  assert.ok(at("4 validators") < at("Recorded here."))
  assert.match(svg, /prefers-reduced-motion/)
})

test("the committed demo carries no address, no 32-byte value and no URL in its text", () => {
  const svg = readFileSync(new URL("../docs/demo.svg", import.meta.url), "utf8")
  const text = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join("\n")
  assert.ok(text.includes("› status {}"))
  assert.doesNotMatch(text, /0x[0-9a-fA-F]{40}/)
  assert.doesNotMatch(text, /https?:\/\//)
})
