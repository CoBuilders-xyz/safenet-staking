import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// The order of approval and credentials in the release workflows, read from their text.
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

const needs = (job) => job.match(/^ {4}needs: (.+)$/m)?.[1].replace(/[[\]\s]/g, "").split(",") ?? []
const environment = (job) => job.match(/^ {4}environment: (\S+)$/m)?.[1]

test("a web release asks for one approval, after the build and before the pin", () => {
  const j = jobs("release.yml")
  assert.deepEqual(Object.keys(j), ["build", "approve", "pin", "smoke", "publish"])
  assert.equal(environment(j.build), undefined)
  assert.deepEqual(needs(j.approve), ["build"])
  assert.equal(environment(j.approve), "production")
  assert.ok(needs(j.pin).includes("approve"))
  assert.equal(environment(j.pin), undefined)
  assert.ok(needs(j.smoke).includes("pin"))
  assert.equal(environment(j.smoke), undefined)
  assert.ok(needs(j.publish).includes("smoke"))
  assert.equal(environment(j.publish), "web-release")
})

test("the Vercel upload runs from the repository root, where the Root Directory apps/web exists", () => {
  const step = jobs("release.yml").publish.split("- name: Upload to Vercel without the production domain")[1]?.split("\n      - ")[0]
  assert.ok(step, "release.yml has the Vercel upload step")
  assert.doesNotMatch(step, /\bcd\b/)
  assert.match(step, /cp -R apps\/web\/dist\/\. \.vercel\/output\/static\//)
  assert.match(step, /deploy --prebuilt --prod --skip-domain/)
})
