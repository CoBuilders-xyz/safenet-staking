import assert from "node:assert/strict"
import { chromium } from "@playwright/test"

const api = process.env.API_URL, reference = process.env.REFERENCE_URL
if (!api || !reference) throw new Error("Set API_URL and REFERENCE_URL. Build the pinned reference with VITE_VALIDATOR_INFO_URL=<API_URL>/v1/validators.")
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors: string[] = []
  page.on("pageerror", e => errors.push(e.message))
  const responsePromise = page.waitForResponse(r => r.url() === new URL("/v1/validators", api).href, { timeout: 45000 })
  await page.goto(new URL("/#/validators", reference).href)
  const response = await responsePromise
  assert.equal(response.status(), 200)
  const rows = await response.json() as { address: string; label: string; commission: number; is_active: boolean; participation_rate_14d: number | null }[]
  assert.ok(rows.length)
  await page.getByTitle("Copy validator address", { exact: true }).first().waitFor({ timeout: 30000 })
  assert.equal(await page.getByTitle("Copy validator address", { exact: true }).count(), rows.length)
  assert.equal(await page.getByText("Active", { exact: true }).count(), rows.filter(r => r.is_active).length)
  assert.equal(await page.getByText("Inactive", { exact: true }).count(), rows.filter(r => !r.is_active).length)
  for (const row of rows) {
    const link = page.locator(`a[href="#/validators/${row.address}"]`).first()
    await link.waitFor({ state: "attached" })
    const card = link.locator("..", {}).locator("..").locator("..")
    assert.equal(await link.innerText(), row.label)
    assert.ok((await card.innerText()).includes(`${Math.round(row.commission * 10000) / 100}%`))
    if (row.participation_rate_14d !== null) {
      const percent = Math.round(row.participation_rate_14d * 10000) / 100
      assert.ok((await card.innerText()).includes(`${percent}%`))
    }
  }
  assert.deepEqual(errors, [])
  const output = process.env.REFERENCE_SCREENSHOT ?? "/tmp/cob590-reference.png"
  await page.screenshot({ path: output, fullPage: true })
  console.log(JSON.stringify({ result: "PASS", checkedAt: new Date().toISOString(), validators: rows.length,
    api: new URL(api).origin, reference: new URL(reference).origin,
    screenshot: output, mocks: false, limitation: "This verifies the running reference frontend and API URL supplied. It does not establish a production deployment." }))
} finally { await browser.close() }
