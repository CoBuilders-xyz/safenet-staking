import { test, expect } from "../fixtures/base.fixture"
import { CHAIN_ID_HEX, TEST_USER } from "../fixtures/test-data"

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
 * The app framed by a page on another origin, as Safe{Wallet} frames it, with a parent that
 * answers the one Safe Apps SDK request the Safe connector makes before it connects,
 * `getSafeInfo`. What this proves: inside a cross-origin iframe, `isSafeApp` is true,
 * `useAutoConnect` connects the Safe connector rather than restoring another wallet, and the
 * address the parent names becomes the connected account. What it does not prove: that
 * Safe{Wallet} itself answers the same way, or that a transaction goes through a Safe. The parent
 * here is a stand-in; nothing ran inside a real Safe.
 */
test.describe("Safe App, framed from another origin", () => {
  test("takes the Safe connector path and connects the Safe the parent names", async ({ disconnectedPage: page, baseURL }) => {
    const app = new URL(baseURL ?? "")
    // Another host on the same loopback port: a different origin and site, so the iframe is
    // cross-origin, and both sides stay on loopback, where Chrome's local network checks do not apply.
    const host = new URL(app.href)
    host.hostname = app.hostname === "127.0.0.1" ? "localhost" : "127.0.0.1"
    expect(host.origin).not.toBe(app.origin)

    // The dev server's frame-ancestors policy admits only the app's own origin and Safe{Wallet}.
    // The test's parent is neither, so the app's document is served without that header. The
    // policy is the server's concern, not the app's; this test is about the app.
    await page.route(
      (url) => url.origin === app.origin && (url.pathname === "/" || url.pathname === "/index.html"),
      async (route) => {
        if (route.request().resourceType() !== "document") return route.fallback()
        const response = await route.fetch()
        const headers = { ...response.headers() }
        delete headers["content-security-policy"]
        await route.fulfill({ response, headers })
      },
    )

    const safeInfo = { safeAddress: TEST_USER, chainId: parseInt(CHAIN_ID_HEX, 16), threshold: 1, owners: [TEST_USER], isReadOnly: false }
    await page.route(`${host.origin}/__safe_host__`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!DOCTYPE html><html><body style="margin:0">
<script>
  // The Safe Apps SDK's message format: a request { id, method, params, env }, answered with
  // { id, success, version, data } from the parent window.
  window.__safeRequests = []
  window.addEventListener("message", (event) => {
    const request = event.data
    if (!request || typeof request.method !== "string" || typeof request.id !== "string") return
    window.__safeRequests.push({ method: request.method, origin: event.origin })
    if (request.method === "getSafeInfo") {
      event.source.postMessage({ id: request.id, success: true, version: "1.0.0", data: ${JSON.stringify(safeInfo)} }, event.origin)
    }
  })
</script>
<iframe src="${app.origin}/#/" style="width:100vw;height:100vh;border:0"></iframe>
</body></html>`,
      }),
    )

    await page.goto(`${host.origin}/__safe_host__`)
    const frame = page.frameLocator("iframe")

    // The connected account is the Safe's, shown without a Connect or Disconnect control.
    const truncated = TEST_USER.slice(0, 6) + "..." + TEST_USER.slice(-4)
    await expect(frame.getByText(truncated)).toBeVisible({ timeout: 15_000 })
    await expect(frame.getByRole("button", { name: "Connect Wallet" })).toHaveCount(0)
    await expect(frame.getByRole("button", { name: "Disconnect" })).toHaveCount(0)

    // The request came from the framed app, on its own origin, to this parent.
    const requests = await page.evaluate(() => (window as unknown as { __safeRequests: { method: string; origin: string }[] }).__safeRequests)
    expect(requests).toContainEqual({ method: "getSafeInfo", origin: app.origin })
  })
})
