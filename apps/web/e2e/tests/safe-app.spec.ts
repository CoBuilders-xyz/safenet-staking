import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"
import { CHAIN_ID_HEX, TEST_USER } from "../fixtures/test-data"
import { SAFE_INFO_TIMEOUT_MS } from "../../src/lib/safe"

/**
 * Smoke coverage of the UI branch. `isSafeApp` (src/lib/safe.ts) is purely `window.self !== window.top`,
 * so a bare iframe is enough to exercise the UI branch that hides Connect/Disconnect — no
 * response is needed from a "Safe host" for that. Fully simulating the Safe Apps SDK
 * postMessage protocol (so the auto-connect in useAutoConnect.ts actually succeeds and
 * transactions can be driven end-to-end) was scoped out; full transactional coverage for
 * the Safe App connection mode is manual-QA-only — see MANUAL_TESTING.md.
 */
test.describe("Safe App (smoke)", () => {
  test("hides Connect/Disconnect buttons but still renders public data inside an iframe", async ({ disconnectedPage: page }) => {
    // Same-origin as the app itself: a cross-origin "Safe host" gets blocked by Chrome's
    // Private Network Access checks when embedding a localhost iframe (public -> local).
    // The wrapper page's own origin doesn't matter for what we're testing (isSafeApp is
    // purely window.self !== window.top), so serving it from the app's own origin sidesteps
    // that restriction entirely.
    const hostPath = "/__safe_host_test__"
    await page.route(`**${hostPath}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!DOCTYPE html><html><body style="margin:0"><iframe src="/#/validators" style="width:100vw;height:100vh;border:0"></iframe></body></html>`,
      })
    })

    await page.goto(hostPath)
    const app = page.frameLocator("iframe")

    // Public data (validator name, stake, participation) still renders without any connection
    await expect(app.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })
    await expect(app.getByText("Total SAFE Staked").first()).toBeVisible()

    // In a Safe App iframe, auto-connect handles the connection — no manual Connect/Disconnect UI
    await expect(app.getByRole("button", { name: "Connect Wallet" })).toHaveCount(0)
    await expect(app.getByRole("button", { name: "Disconnect" })).toHaveCount(0)
  })
})

/**
 * Serves a parent page on another loopback origin that frames the app at `route`, records every
 * Safe Apps SDK request the frame posts, and, when `answerAfterMs` is set, answers `getSafeInfo`
 * for TEST_USER after that delay, as Safe{Wallet} would. Returns the app's origin.
 */
async function frameFromAnotherOrigin(page: Page, baseURL: string | undefined, route: string, answerAfterMs?: number): Promise<string> {
  const app = new URL(baseURL ?? "")
  // Another host on the same loopback port: a different origin and site, so the iframe is
  // cross-origin, and both sides stay on loopback, where Chrome's local network checks do not apply.
  const host = new URL(app.href)
  host.hostname = app.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1"
  expect(host.origin).not.toBe(app.origin)

  // The dev server's frame-ancestors policy admits only the app's own origin and Safe{Wallet}.
  // The test's parent is neither, so the app's document is served without that header. The
  // policy is the server's concern, not the app's; these tests are about the app.
  await page.route(
    (url) => url.origin === app.origin && (url.pathname === "/" || url.pathname === "/index.html"),
    async (r) => {
      if (r.request().resourceType() !== "document") return r.fallback()
      const response = await r.fetch()
      const headers = { ...response.headers() }
      delete headers["content-security-policy"]
      await r.fulfill({ response, headers })
    },
  )

  const safeInfo = { safeAddress: TEST_USER, chainId: parseInt(CHAIN_ID_HEX, 16), threshold: 1, owners: [TEST_USER], isReadOnly: false }
  const answer =
    answerAfterMs === undefined
      ? ""
      : `if (request.method === "getSafeInfo") setTimeout(() => event.source.postMessage({ id: request.id, success: true, version: "1.0.0", data: ${JSON.stringify(safeInfo)} }, event.origin), ${answerAfterMs})`
  await page.route(`${host.origin}/__safe_host__`, (r) =>
    r.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!DOCTYPE html><html><body style="margin:0">
<script>
  // A Safe Apps SDK request is { id, method, params, env }, posted to the parent window, and
  // answered with { id, success, version, data }.
  window.__safeRequests = []
  window.addEventListener("message", (event) => {
    const request = event.data
    if (!request || typeof request.method !== "string" || typeof request.id !== "string") return
    window.__safeRequests.push({ method: request.method, origin: event.origin })
    ${answer}
  })
</script>
<iframe src="${app.origin}/#/${route}" style="width:100vw;height:100vh;border:0"></iframe>
</body></html>`,
    }),
  )
  await page.goto(`${host.origin}/__safe_host__`)
  return app.origin
}

/** The Safe Apps SDK requests the framed app posted to the test's parent. */
function safeRequests(page: Page) {
  return page.evaluate(() => (window as unknown as { __safeRequests: { method: string; origin: string }[] }).__safeRequests)
}

/**
 * The app framed by a page on another origin, as Safe{Wallet} frames it. What the first test
 * proves, inside a cross-origin iframe: `isSafeApp` is true, so no Connect control shows and
 * `useAutoConnect` connects the Safe connector rather than calling `reconnect()`; and the Safe
 * connector runs, asking the parent for the Safe's details with `getSafeInfo`. The request alone
 * would not tell the two branches apart, because `reconnect()` also asks it; the absent Connect
 * control does. With `isSafeApp` forced to false, that test fails on that control.
 *
 * The second proves the connection completes when the parent answers late. Safe{Wallet} answered
 * in tens to hundreds of milliseconds while a page loads, measured on 2026-10-27, and wagmi's
 * default wait of 10 ms then failed the connection. With the default restored, the second test
 * fails. Nothing here ran inside a real Safe, and no transaction goes through a Safe.
 */
test.describe("Safe App, framed from another origin", () => {
  test("takes the Safe connector path: asks the parent for the Safe's details", async ({ disconnectedPage: page, baseURL }) => {
    const appOrigin = await frameFromAnotherOrigin(page, baseURL, "validators")
    const frame = page.frameLocator("iframe")
    await expect(frame.getByRole("link", { name: "Validator A" })).toBeVisible({ timeout: 15_000 })

    // The request came from the framed app, on its own origin, to this parent.
    await expect.poll(() => safeRequests(page)).toContainEqual({ method: "getSafeInfo", origin: appOrigin })

    // isSafeApp is true: the Connect control is hidden, as only a Safe App hides it.
    await expect(frame.getByRole("button", { name: "Connect Wallet" })).toHaveCount(0)
  })

  test("connects the Safe the parent names when the parent answers 15 ms late", async ({ disconnectedPage: page, baseURL }) => {
    expect(SAFE_INFO_TIMEOUT_MS).toBeGreaterThan(15)
    await frameFromAnotherOrigin(page, baseURL, "", 15)
    const frame = page.frameLocator("iframe")

    const truncated = TEST_USER.slice(0, 6) + "..." + TEST_USER.slice(-4)
    await expect(frame.getByText(truncated)).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByRole("button", { name: "Connect Wallet" })).toHaveCount(0)
    await expect(frame.getByRole("button", { name: "Disconnect" })).toHaveCount(0)
  })
})
