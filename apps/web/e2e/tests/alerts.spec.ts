import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"

interface Subscription {
  id: string; channel: string; triggers: string[]; participation: number; missed: number
  status: string; linked: boolean; lastDelivery: null
}
async function service(page: Page, options: { fail?: boolean; verify?: boolean } = {}) {
  const subscriptions: Subscription[] = []
  await page.route("https://mock-alerts.test/**", async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    if (options.fail) return route.fulfill({ status: 503, headers, json: { error: "unavailable" } })
    if (path === "/config") return route.fulfill({ headers, json: { telegramBot: "test_bot", vapidPublicKey: "test" } })
    if (path === "/auth/challenge") return route.fulfill({ headers, json: { id: "challenge", message: "Sign this local alert test", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    if (path === "/auth/verify") return route.fulfill({ headers, json: { token: "test-session", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    if (request.method() === "DELETE") subscriptions.splice(0)
    else if (request.method() === "POST" && path === "/subscriptions") {
      const data = request.postDataJSON()
      subscriptions.push({ ...data, id: "subscription", channel: data.channel.kind, status: options.verify ? "verified" : "unverified", linked: false, lastDelivery: null })
      return route.fulfill({ headers, json: { id: "subscription", telegramUrl: "https://t.me/test_bot?start=local-test" } })
    }
    return route.fulfill({ headers, json: subscriptions })
  })
  return subscriptions
}

test("alerts explains wallet connection and passes accessibility checks", async ({ disconnectedPage: page }) => {
  await page.goto("/#/alerts")
  await expect(page.getByRole("heading", { name: "Alerts", exact: true })).toBeVisible()
  await expect(page.getByText("Connect your wallet to set up alerts.")).toBeVisible()
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([])
})

test("signs, selects all five triggers, links Telegram, shows unverified delivery and deletes subscription", async ({ connectedPage: page }) => {
  const subscriptions = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
  for (const label of ["Rewards claimable", "Validator deregistered", "Participation below my threshold", "Consecutive missed signing rounds"]) {
    await page.getByRole("checkbox", { name: label, exact: true }).check()
  }
  await page.getByRole("spinbutton", { name: "Participation threshold (%)" }).fill("80")
  await page.getByRole("spinbutton", { name: "Consecutive rounds (1–1000)" }).fill("4")
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByText(/Subscribed — delivery unverified/)).toBeVisible()
  await expect(page.getByRole("link", { name: "Open Telegram and press Start" })).toHaveAttribute("href", /https:\/\/t.me\/test_bot/)
  await expect(page.getByText("Waiting for the Telegram link. After you press Start, this can take up to 5 minutes.")).toBeVisible()
  await expect(page.getByText("Telegram linked", { exact: false })).toHaveCount(0)
  expect(subscriptions[0]!.triggers).toHaveLength(5)
  expect(subscriptions[0]!.participation).toBe(80)
  expect(subscriptions[0]!.missed).toBe(4)
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([])
  await page.getByRole("button", { name: "Delete subscription" }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
})

test("a pending Telegram link turns into a linked confirmation while delivery stays unverified", async ({ connectedPage: page }) => {
  const subscriptions = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByText("Waiting for the Telegram link. After you press Start, this can take up to 5 minutes.")).toBeVisible()
  subscriptions[0]!.linked = true // The Worker's Cron run binds the chat; the page polls while the link is pending.
  await expect(page.getByText("Telegram linked. Alerts go to your private chat with the bot.")).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText("Waiting for the Telegram link", { exact: false })).toHaveCount(0)
  await expect(page.getByText("Open the Telegram link and press Start within ten minutes", { exact: false })).toHaveCount(0)
  await expect(page.getByText(/Subscribed — delivery unverified/)).toBeVisible()
})

test("cleared thresholds do not invalidate a subscription after their triggers are removed", async ({ connectedPage: page }) => {
  const subscriptions = await service(page)
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
  await expect(page.getByText(/Subscribed — delivery unverified/)).toBeVisible()
  expect(subscriptions[0]!.triggers).toEqual(["cooldown"])
  expect(subscriptions[0]!.participation).toBe(75)
  expect(subscriptions[0]!.missed).toBe(3)
})

test("browser permission failure remains visible and creates no subscription", async ({ connectedPage: page }) => {
  const subscriptions = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByLabel("Delivery channel").selectOption("push")
  await page.evaluate(() => { Notification.requestPermission = async () => "denied" })
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("Could not complete the request")
  expect(subscriptions).toHaveLength(0)
})

test("service error is accessible on mobile without horizontal overflow", async ({ connectedPage: page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await service(page, { fail: true })
  await page.goto("/#/alerts")
  await expect(page.getByRole("alert")).toContainText("Could not complete the request")
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test("provider-confirmed state is shown separately from subscription creation", async ({ connectedPage: page }) => {
  await service(page, { verify: true })
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByText("Delivery confirmed", { exact: true })).toBeVisible()
})

test("browser subscription saves the selected device endpoint and remains unverified before delivery", async ({ connectedPage: page }) => {
  const subscriptions = await service(page)
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
  await expect(page.getByText(/Subscribed — delivery unverified/)).toBeVisible()
  expect(subscriptions[0]!.channel).toBe("push")
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
      json: attempts.length === 1 ? { error: "approval pending" } : { token: "approved", expiresAt: new Date(Date.now() + 300_000).toISOString() },
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
