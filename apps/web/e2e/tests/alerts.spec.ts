import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"

interface Subscription {
  id: string; channel: string; triggers: string[]; participation: number; missed: number
  status: string; linked: boolean; linkedAt: string | null; linkExpiresAt: string | null; paused: boolean; lastDelivery: null
}
interface Service {
  subscriptions: Subscription[]; calls: string[]; refuse: Record<string, { status: number; code: string }>
  /** The next new-link request issues the code and then loses its answer. */
  loseLinkAnswer: boolean
}
async function service(page: Page, options: { fail?: boolean; verify?: boolean; max?: number } = {}): Promise<Service> {
  const state: Service = { subscriptions: [], calls: [], refuse: {}, loseLinkAnswer: false }
  let links = 0
  await page.route("https://mock-alerts.test/**", async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    if (options.fail) return route.fulfill({ status: 503, headers, json: { error: "Service unavailable", code: "unavailable" } })
    if (path === "/config") return route.fulfill({ headers, json: { telegramBot: "test_bot", vapidPublicKey: "test", maxSubscriptions: options.max ?? 10 } })
    if (path === "/auth/challenge") return route.fulfill({ headers, json: { id: "challenge", message: "Sign this local alert test", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    if (path === "/auth/verify") return route.fulfill({ headers, json: { token: "test-session", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    const action = /^\/subscriptions\/([^/]+)\/(telegram-link|pause|resume|test)$/.exec(path)
    if (request.method() === "POST" && action) {
      const [, id, name] = action as unknown as [string, string, string]
      state.calls.push(name)
      const refusal = state.refuse[name]
      if (refusal) return route.fulfill({ status: refusal.status, headers, json: { error: "refused", code: refusal.code } })
      const sub = state.subscriptions.find(item => item.id === id)!
      if (name === "pause" || name === "resume") { sub.paused = name === "pause"; return route.fulfill({ headers, json: { paused: sub.paused } }) }
      if (name === "test") return route.fulfill({ headers, json: { sent: true } })
      sub.linkExpiresAt = new Date(Date.now() + 600_000).toISOString()
      if (state.loseLinkAnswer) { state.loseLinkAnswer = false; return route.abort() }
      return route.fulfill({ headers, json: { telegramUrl: `https://t.me/test_bot?start=reissued-${++links}`, expiresAt: sub.linkExpiresAt } })
    }
    if (request.method() === "DELETE") state.subscriptions.splice(0)
    else if (request.method() === "POST" && path === "/subscriptions") {
      const refusal = state.refuse.subscribe
      if (refusal) return route.fulfill({ status: refusal.status, headers, json: { error: "refused", code: refusal.code } })
      const data = request.postDataJSON()
      const telegram = data.channel.kind === "telegram"
      const id = `subscription-${state.subscriptions.length + 1}`
      state.subscriptions.push({ ...data, id, channel: data.channel.kind, status: options.verify ? "verified" : "unverified", linked: !telegram,
        linkedAt: null, linkExpiresAt: telegram ? new Date(Date.now() + 600_000).toISOString() : null, paused: false, lastDelivery: null })
      return route.fulfill({ headers, json: { id, telegramUrl: telegram ? "https://t.me/test_bot?start=local-test" : null, expiresAt: state.subscriptions.at(-1)!.linkExpiresAt } })
    }
    return route.fulfill({ headers, json: state.subscriptions })
  })
  return state
}
const waiting = "Not connected yet. Open Telegram and press Start. After you press Start, connecting can take up to 5 minutes. This page updates by itself."
const expiredLink = "Still not connected. The Telegram link has expired. If you pressed Start before that, wait up to 5 minutes: this page updates by itself. If not, get a new link, open it and press Start."

test("alerts explains wallet connection and passes accessibility checks", async ({ disconnectedPage: page }) => {
  await page.goto("/#/alerts")
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible()
  await expect(page.getByText("Connect your wallet to set up alerts.")).toBeVisible()
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([])
})

test("signs, selects all five triggers, shows the Telegram link in its card and deletes after confirmation", async ({ connectedPage: page }) => {
  const { subscriptions } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
  for (const label of ["Rewards claimable", "Validator deregistered", "Participation below my threshold", "Consecutive missed signing rounds"]) {
    await page.getByRole("checkbox", { name: label, exact: true }).check()
  }
  await page.getByRole("spinbutton", { name: "Participation threshold (%)" }).fill("80")
  await page.getByRole("spinbutton", { name: "Consecutive rounds (1–1000)" }).fill("4")
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText(waiting)
  await expect(card.getByText("Minutes left on this link: 10.")).toBeVisible()
  // The link is inside its own card, and receives focus after the subscription is created.
  const link = card.getByRole("link", { name: "Open Telegram and press Start" })
  await expect(link).toHaveAttribute("href", "https://t.me/test_bot?start=local-test")
  await expect(link).toBeFocused()
  // A new link would cancel this one, so the card does not offer it while this one can be opened.
  await expect(card.getByRole("button", { name: "Get a new Telegram link" })).toHaveCount(0)
  await expect(card.getByRole("button", { name: "Send test message" })).toHaveCount(0) // Nothing to test before a chat is linked.
  expect(subscriptions[0]!.triggers).toHaveLength(5)
  expect(subscriptions[0]!.participation).toBe(80)
  expect(subscriptions[0]!.missed).toBe(4)
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([])
  // Delete asks first; Cancel keeps the subscription.
  await card.getByRole("button", { name: "Delete subscription" }).click()
  await expect(card.getByText("Delete this subscription? Its alerts stop at once.")).toBeVisible()
  await card.getByRole("button", { name: "Cancel" }).click()
  expect(subscriptions).toHaveLength(1)
  await card.getByRole("button", { name: "Delete subscription" }).click()
  await card.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
})

test("a pending Telegram link becomes one Connected status, with a test message and pause", async ({ connectedPage: page }) => {
  const { subscriptions, calls, refuse } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText(waiting)
  // The Worker's Cron run binds the chat; the page polls while the link is pending.
  Object.assign(subscriptions[0]!, { linked: true, linkedAt: "2026-11-13T20:05:35.000Z", linkExpiresAt: null })
  await expect(card.getByRole("status")).toHaveText("Connected to Telegram since 13 November 2026.", { timeout: 15_000 })
  // One status: nothing about an unverified delivery, and no link controls once connected.
  await expect(page.getByText(/unverified/i)).toHaveCount(0)
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveCount(0)
  await expect(card.getByRole("button", { name: "Get a new Telegram link" })).toHaveCount(0)
  await card.getByRole("button", { name: "Send test message" }).click()
  await expect(card.getByText("Test message sent. Check your Telegram chat.")).toBeVisible()
  refuse.test = { status: 429, code: "rate" }
  await card.getByRole("button", { name: "Send test message" }).click()
  await expect(card.getByRole("alert")).toHaveText("Too many requests. Wait a minute, then try again.")
  await card.getByRole("button", { name: "Pause" }).click()
  await expect(card.getByRole("status")).toHaveText("Paused. No alerts are sent until you resume.")
  await card.getByRole("button", { name: "Resume" }).click()
  await expect(card.getByRole("status")).toHaveText("Connected to Telegram since 13 November 2026.")
  expect(calls).toEqual(["test", "test", "pause", "resume"])
})

test("a lost or expired Telegram link is replaced from the card, without deleting the subscription", async ({ connectedPage: page }) => {
  const { subscriptions, calls } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toBeVisible()
  // The link expires before Start: the card says so and stops offering the dead link.
  subscriptions[0]!.linkExpiresAt = new Date(Date.now() - 1000).toISOString()
  await expect(card.getByRole("status")).toHaveText(expiredLink, { timeout: 15_000 })
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveCount(0)
  await card.getByRole("button", { name: "Get a new Telegram link" }).click()
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveAttribute("href", "https://t.me/test_bot?start=reissued-1")
  await expect(card.getByRole("status")).toHaveText(waiting)
  // After a reload the page has no link to show, so the card offers a new one.
  await page.reload()
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await expect(card.getByRole("status")).toHaveText("Not connected yet. If you already pressed Start, wait up to 5 minutes: this page updates by itself. If not, get a new Telegram link, open it and press Start.")
  await card.getByRole("button", { name: "Get a new Telegram link" }).click()
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveAttribute("href", "https://t.me/test_bot?start=reissued-2")
  expect(calls).toEqual(["telegram-link", "telegram-link"])
  expect(subscriptions).toHaveLength(1)
})

test("a new link whose answer is lost does not revive the old link", async ({ connectedPage: page }) => {
  const service_ = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toBeVisible()
  service_.subscriptions[0]!.linkExpiresAt = new Date(Date.now() - 1000).toISOString()
  await expect(card.getByRole("status")).toHaveText(expiredLink, { timeout: 15_000 })
  // The service issues the new code, which cancels the first link, but its answer never arrives.
  service_.loseLinkAnswer = true
  await card.getByRole("button", { name: "Get a new Telegram link" }).click()
  await expect(card.getByRole("alert")).toHaveText("The alerts service did not answer. Check your connection and try again.")
  // The list now shows the new code's expiry. The first link is dead, so the card must not offer it.
  await expect(card.getByRole("status")).toHaveText("Not connected yet. If you already pressed Start, wait up to 5 minutes: this page updates by itself. If not, get a new Telegram link, open it and press Start.")
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveCount(0)
  await card.getByRole("button", { name: "Get a new Telegram link" }).click()
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveAttribute("href", "https://t.me/test_bot?start=reissued-1")
})

test("each failure has its own message, and the form closes at the subscription limit", async ({ connectedPage: page }) => {
  const { refuse } = await service(page, { max: 2 })
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  refuse.subscribe = { status: 503, code: "telegram_unavailable" }
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("Telegram alerts are not available right now. Try again later, or use browser notifications.")
  refuse.subscribe = { status: 409, code: "limit" }
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("You have 2 subscriptions, the maximum. Delete one to add another.")
  delete refuse.subscribe
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("article")).toHaveCount(1)
  await expect(page.getByRole("alert")).toHaveCount(0)
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("article")).toHaveCount(2)
  await expect(page.getByText("You have 2 subscriptions, the maximum. Delete one to add another.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeDisabled()
})

test("cleared thresholds do not invalidate a subscription after their triggers are removed", async ({ connectedPage: page }) => {
  const { subscriptions } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  for (const [trigger, input] of [
    ["Participation below my threshold", "Participation threshold (%)"],
    ["Consecutive missed signing rounds", "Consecutive rounds (1–1000)"],
  ]) {
    await page.getByRole("checkbox", { name: trigger, exact: true }).check()
    await page.getByRole("spinbutton", { name: input }).fill("")
    await page.getByRole("checkbox", { name: trigger, exact: true }).uncheck()
  }
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("article")).toBeVisible()
  expect(subscriptions[0]!.triggers).toEqual(["cooldown"])
  expect(subscriptions[0]!.participation).toBe(75)
  expect(subscriptions[0]!.missed).toBe(3)
})

test("browser permission failure remains visible and creates no subscription", async ({ connectedPage: page }) => {
  const { subscriptions } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByLabel("Delivery channel").selectOption("push")
  await page.evaluate(() => { Notification.requestPermission = async () => "denied" })
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("Notifications are blocked for this site. Allow them in your browser settings, then subscribe again.")
  expect(subscriptions).toHaveLength(0)
})

test("service error is accessible on mobile without horizontal overflow", async ({ connectedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await service(page, { fail: true })
  await page.goto("/#/alerts")
  await expect(page.getByRole("alert")).toHaveText("The alerts service is unavailable. Try again later.")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("a Telegram card shows its link state even when a delivery was confirmed", async ({ connectedPage: page }) => {
  await service(page, { verify: true })
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("article").getByRole("status")).toHaveText(waiting) // A Telegram card shows its link state, not a delivery state.
})

test("browser subscription saves the selected device endpoint and asks for a test before delivery is confirmed", async ({ connectedPage: page }) => {
  const { subscriptions, calls } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByLabel("Delivery channel").selectOption("push")
  await page.evaluate(() => {
    Notification.requestPermission = async () => "granted"
    const registration = {
      scope: location.origin + "/",
      active: { postMessage() {} },
      pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({
        endpoint: "https://fcm.googleapis.com/local-test", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) },
      }) }) },
    }
    Object.defineProperty(navigator.serviceWorker, "register", { value: async () => registration })
    Object.defineProperty(navigator.serviceWorker, "ready", { value: Promise.resolve(registration) })
  })
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText("Subscribed. Send a test notification: the browser you subscribed with should show it.")
  expect(subscriptions[0]!.channel).toBe("push")
  await card.getByRole("button", { name: "Send test notification" }).click()
  await expect(card.getByText("Test notification sent. The browser you subscribed with should show it now.")).toBeVisible()
  expect(calls).toEqual(["test"])
  // The service worker confirms the notification it showed; the card then says so.
  subscriptions[0]!.status = "verified"
  await expect(card.getByRole("status").first()).toHaveText("Notifications reach the browser you subscribed with.", { timeout: 20_000 })
})

test("pending Safe approval retries verification of the same signed challenge", async ({ connectedPage: page }) => {
  await service(page)
  let challenges = 0
  const attempts: unknown[] = []
  page.on("request", request => { if (new URL(request.url()).pathname === "/auth/challenge") challenges++ })
  await page.route("https://mock-alerts.test/auth/verify", async route => {
    if (route.request().method() === "OPTIONS") return route.fallback()
    attempts.push(route.request().postDataJSON())
    await route.fulfill({ status: attempts.length === 1 ? 401 : 200,
      headers: { "Access-Control-Allow-Origin": new URL(page.url()).origin },
      json: attempts.length === 1 ? { error: "Wallet verification failed", code: "session" } : { token: "approved", expiresAt: new Date(Date.now() + 300_000).toISOString() },
    })
  })
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await expect(page.getByRole("alert")).toContainText("Safe signatures require threshold approval")
  await page.getByRole("button", { name: "Retry signature verification" }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
  expect(challenges).toBe(1)
  expect(attempts[1]).toEqual(attempts[0])
})
