import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// The release workflow, read from its text.
function jobs(file) {
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows", file), "utf8")
  const body = text.split("\njobs:\n")[1]
  assert.ok(body, `${file} has a jobs section`)
  const out = {}
  for (const part of body.split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)) {
    const name = part.match(/^ {2}([a-z][a-z0-9-]*):\n/)?.[1]
    if (name) out[name] = part
  }
  return out
}

test("the Vercel upload runs from the repository root, where the Root Directory apps/web exists", () => {
  const step = jobs("release.yml").publish.split("- name: Upload to Vercel without the production domain")[1]?.split("\n      - ")[0]
  assert.ok(step, "release.yml has the Vercel upload step")
  assert.doesNotMatch(step, /\bcd\b|working-directory:/)
  // No default working directory at workflow or job scope moves it either.
  const text = readFileSync(resolve(import.meta.dirname, "../../.github/workflows/release.yml"), "utf8")
  assert.doesNotMatch(text, /^\s*defaults:/m)
  assert.match(step, /cp -R apps\/web\/dist\/\. \.vercel\/output\/static\//)
  assert.match(step, /deploy --prebuilt --prod --skip-domain/)
})
