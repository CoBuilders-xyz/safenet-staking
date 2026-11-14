import AxeBuilder from "@axe-core/playwright"
import type { Page } from "@playwright/test"
import { test, expect } from "../fixtures/base.fixture"

interface Subscription {
  id: string; channel: string; triggers: string[]; participation: number; missed: number
  status: string; linked: boolean; linkedAt: string | null; linkExpiresAt: string | null; paused: boolean; lastDelivery: null
  /** When the last test was sent. The list answers the seconds left, as the service does. */
  testedAt?: number
}
interface Service {
  subscriptions: Subscription[]; calls: string[]; refuse: Record<string, { status: number; code: string }>
  /** The next new-link request issues the code and then loses its answer. */
  loseLinkAnswer: boolean
  /** Reads of the list, by time. */
  reads: number[]
  /** Milliseconds each answer waits, to see the states in between. */
  delay: number
}
const TEST_INTERVAL = 60_000
async function service(page: Page, options: { fail?: boolean; verify?: boolean; max?: number; telegram?: boolean } = {}): Promise<Service> {
  const state: Service = { subscriptions: [], calls: [], refuse: {}, loseLinkAnswer: false, reads: [], delay: 0 }
  let links = 0
  await page.route("https://mock-alerts.test/**", async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const headers = { "Access-Control-Allow-Origin": new URL(page.url()).origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" }
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers })
    if (options.fail) return route.fulfill({ status: 503, headers, json: { error: "Service unavailable", code: "unavailable" } })
    if (path === "/config") return route.fulfill({ headers, json: { telegramBot: options.telegram === false ? null : "test_bot", vapidPublicKey: "test", maxSubscriptions: options.max ?? 10 } })
    if (path === "/auth/challenge") return route.fulfill({ headers, json: { id: "challenge", message: "Sign this local alert test", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    if (path === "/auth/verify") return route.fulfill({ headers, json: { token: "test-session", expiresAt: new Date(Date.now() + 300_000).toISOString() } })
    if (state.delay && request.method() !== "GET") await new Promise(resolve => setTimeout(resolve, state.delay))
    const action = /^\/subscriptions\/([^/]+)\/(telegram-link|pause|resume|test)$/.exec(path)
    if (request.method() === "POST" && action) {
      const [, id, name] = action as unknown as [string, string, string]
      state.calls.push(name)
      const refusal = state.refuse[name]
      if (refusal) return route.fulfill({ status: refusal.status, headers, json: { error: "refused", code: refusal.code } })
      const sub = state.subscriptions.find(item => item.id === id)!
      if (name === "pause" || name === "resume") { sub.paused = name === "pause"; return route.fulfill({ headers, json: { paused: sub.paused } }) }
      if (name === "test") { sub.testedAt = Date.now(); return route.fulfill({ headers, json: { sent: true, retryAfter: TEST_INTERVAL / 1000 } }) }
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
    state.reads.push(Date.now())
    return route.fulfill({ headers, json: state.subscriptions.map(({ testedAt, ...sub }) =>
      ({ ...sub, testRetryAfter: testedAt ? Math.max(0, Math.ceil((testedAt + TEST_INTERVAL - Date.now()) / 1000)) : 0 })) })
  })
  return state
}
/** What Telegram does when the user presses Start: the service links the chat. */
const pressStart = (sub: Subscription) => Object.assign(sub, { linked: true, linkedAt: "2026-11-13T20:05:35.000Z", linkExpiresAt: null })
const waiting = "Open Telegram and press Start. This card updates as soon as you do."
const noLinkHere = "Not connected yet. If you just pressed Start, this card updates in a few seconds. If not, get a new Telegram link, open it and press Start."
const expiredLink = "The Telegram link expired before Start was pressed. Get a new link, open it and press Start."
const connected = "Connected to Telegram since 13 November 2026."
const axe = async (page: Page) => {
  const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(scan.violations.filter(v => v.impact === "serious" || v.impact === "critical")).toEqual([])
}

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
  await expect(card.getByText("Waiting for Start", { exact: true })).toBeVisible()
  await expect(card.getByText("Minutes left on this link: 10.")).toBeVisible()
  // The link is inside its own card, and receives focus after the subscription is created.
  const link = card.getByRole("link", { name: "Open Telegram and press Start" })
  await expect(link).toHaveAttribute("href", "https://t.me/test_bot?start=local-test")
  await expect(link).toBeFocused()
  // A new link would cancel this one, so the card does not offer it while this one can be opened.
  await expect(card.getByRole("button", { name: "Get a new Telegram link" })).toHaveCount(0)
  await expect(card.getByRole("button", { name: "Get test notification" })).toHaveCount(0) // Nothing to test before a chat is linked.
  expect(subscriptions[0]!.triggers).toHaveLength(5)
  expect(subscriptions[0]!.participation).toBe(80)
  expect(subscriptions[0]!.missed).toBe(4)
  await axe(page)
  // Delete asks first; Cancel keeps the subscription.
  await card.getByRole("button", { name: "Delete subscription" }).click()
  await expect(card.getByText("Delete this subscription? Its alerts stop at once.")).toBeVisible()
  await card.getByRole("button", { name: "Cancel" }).click()
  expect(subscriptions).toHaveLength(1)
  await card.getByRole("button", { name: "Delete subscription" }).click()
  await card.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText("You have no alert subscriptions.")).toBeVisible()
})

test("the card connects within two seconds of Start, and the test button takes the focus", async ({ connectedPage: page }) => {
  const { subscriptions, reads } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  const link = card.getByRole("link", { name: "Open Telegram and press Start" })
  await expect(link).toBeFocused()
  // Opening Telegram says what the page is waiting for. The link stays, to open Telegram again.
  await page.context().route("https://t.me/**", route => route.fulfill({ body: "Telegram" }))
  const [telegram] = await Promise.all([page.waitForEvent("popup"), link.click()])
  await telegram.close()
  await expect(card.getByRole("status")).toHaveText("Waiting for you to press Start in Telegram. This card updates as soon as you do.")
  await expect(card.getByRole("link", { name: "Open Telegram again" })).toHaveAttribute("href", "https://t.me/test_bot?start=local-test")
  // While it waits, the page reads the list every second or two.
  const from = Date.now()
  await page.waitForTimeout(4000)
  expect(reads.filter(at => at >= from).length).toBeGreaterThanOrEqual(2)
  const pressed = Date.now()
  pressStart(subscriptions[0]!)
  await expect(card.getByRole("status").first()).toHaveText(connected, { timeout: 2500 })
  expect(Date.now() - pressed).toBeLessThan(2500)
  await expect(card.getByText("Connected", { exact: true })).toBeVisible()
  await expect(card.getByText("Telegram is connected. Get a test notification to see one arrive.")).toBeVisible()
  // The link that held the focus is gone, so the next action has it. No link controls remain.
  await expect(card.getByRole("button", { name: "Get test notification" })).toBeFocused()
  await expect(card.getByRole("link")).toHaveCount(0)
  await expect(card.getByRole("button", { name: "Get a new Telegram link" })).toHaveCount(0)
  await expect(page.getByText(/unverified/i)).toHaveCount(0)
  await page.mouse.move(0, 0) // The scan reads the button at rest, not under the pointer that pressed the link.
  await axe(page)
})

test("a hidden page reads the list again at once when it is shown, as on the return from Telegram", async ({ connectedPage: page }) => {
  const { subscriptions, reads } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText(waiting)
  const visibility = (state: "hidden" | "visible") => page.evaluate(value => {
    Object.defineProperty(document, "visibilityState", { value, configurable: true })
    document.dispatchEvent(new Event("visibilitychange", { bubbles: true }))
  }, state)
  await visibility("hidden")
  await page.waitForTimeout(500) // A read already on its way may still land.
  const hiddenFrom = Date.now()
  await page.waitForTimeout(3500)
  expect(reads.filter(at => at >= hiddenFrom)).toEqual([]) // A hidden page asks nothing.
  pressStart(subscriptions[0]!)
  await visibility("visible")
  await expect(card.getByRole("status").first()).toHaveText(connected, { timeout: 1000 })
})

test("Get test notification sends at once, shows the result, and counts down to the next one", async ({ connectedPage: page }) => {
  const mock = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText(waiting)
  pressStart(mock.subscriptions[0]!)
  const test = card.getByRole("button", { name: "Get test notification" })
  await expect(test).toBeVisible()
  // While the request is on its way the button says so, and a second press sends nothing.
  mock.delay = 700
  await test.click()
  const sending = card.getByRole("button", { name: "Sending…" })
  await expect(sending).toHaveAttribute("aria-disabled", "true")
  await sending.click({ force: true })
  await expect(card.getByText("Test notification sent. Check your Telegram chat.")).toBeVisible()
  expect(mock.calls).toEqual(["test"])
  // One a minute: the button counts down, keeps the focus, and sends nothing until then.
  const again = card.getByRole("button", { name: /^Test again in \d+ s$/ })
  await expect(again).toHaveAttribute("aria-disabled", "true")
  await expect(again).toBeFocused()
  await again.click({ force: true })
  expect(mock.calls).toEqual(["test"])
  const seconds = async () => Number((await again.textContent())!.match(/\d+/)![0])
  const first = await seconds()
  expect(first).toBeGreaterThan(50)
  await expect.poll(seconds, { timeout: 5000 }).toBeLessThan(first)
  await axe(page)
  // The minute is over: the button is back.
  mock.delay = 0
  mock.subscriptions[0]!.testedAt = Date.now() - 60_000
  await expect(test).toHaveAttribute("aria-disabled", "false", { timeout: 20_000 })
  // Telegram did not take it: the card says so and what to do. The subscription is unchanged.
  mock.refuse.test = { status: 502, code: "delivery" }
  await test.click()
  await expect(card.getByRole("alert")).toHaveText("The test notification could not be delivered. Nothing changed in your subscription. Try again in a minute.")
  await expect(card.getByRole("status").first()).toHaveText(connected)
  // Refused by the limit, as when another tab sent one: the reason, not a generic failure.
  mock.refuse.test = { status: 429, code: "rate" }
  await test.click()
  await expect(card.getByRole("alert")).toHaveText("One test notification per minute for each subscription. Wait for the countdown, then try again.")
  // The chat blocked the bot: the service expires the subscription, and the card says to replace it.
  mock.refuse.test = { status: 409, code: "expired" }
  mock.subscriptions[0]!.status = "expired"
  await test.click()
  await expect(card.getByRole("status").first()).toHaveText("Telegram no longer accepts messages for this chat. Delete this subscription and subscribe again.")
  await expect(card.getByText("Not delivering", { exact: true })).toBeVisible()
  await expect(card.getByRole("button", { name: "Get test notification" })).toHaveCount(0)
})

test("pause and resume keep the card in place and say what they did", async ({ connectedPage: page }) => {
  const { subscriptions, calls } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  const card = page.getByRole("article")
  await expect(card.getByRole("status")).toHaveText(waiting)
  pressStart(subscriptions[0]!)
  await expect(card.getByRole("status").first()).toHaveText(connected, { timeout: 2500 })
  const height = async () => (await card.boundingBox())!.height
  const before = await height()
  await card.getByRole("button", { name: "Pause" }).click()
  await expect(card.getByRole("status").first()).toHaveText("Paused. No alerts are sent until you resume.")
  await expect(card.getByText("Paused", { exact: true })).toBeVisible()
  expect(await height()).toBe(before) // The status and the line under it hold their place.
  await card.getByRole("button", { name: "Resume" }).click()
  await expect(card.getByRole("status").first()).toHaveText(connected)
  expect(calls).toEqual(["pause", "resume"])
})

test("the same alerts cannot be subscribed twice on Telegram: the form says why, and the service's refusal has its own message", async ({ connectedPage: page }) => {
  const { subscriptions, refuse } = await service(page)
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  const subscribe = page.getByRole("button", { name: "Subscribe", exact: true })
  const hint = page.getByText("You already have a Telegram subscription with these same alerts. Change the selection to add another.")
  await page.getByRole("checkbox", { name: "Participation below my threshold", exact: true }).check()
  await page.getByRole("spinbutton", { name: "Participation threshold (%)" }).fill("100")
  await subscribe.click()
  await expect(page.getByRole("article")).toHaveCount(1)
  // The form still holds the same choice. A second press would only repeat the card.
  await expect(hint).toBeVisible()
  await expect(subscribe).toBeDisabled()
  // Another threshold, or other triggers, is another subscription. The same triggers in any order are not.
  await page.getByRole("spinbutton", { name: "Participation threshold (%)" }).fill("90")
  await expect(hint).toHaveCount(0)
  await expect(subscribe).toBeEnabled()
  await page.getByRole("spinbutton", { name: "Participation threshold (%)" }).fill("100")
  await page.getByRole("checkbox", { name: "Cooldown ready to claim", exact: true }).uncheck()
  await expect(subscribe).toBeEnabled()
  await page.getByRole("checkbox", { name: "Cooldown ready to claim", exact: true }).check()
  await expect(hint).toBeVisible()
  // A browser subscription with the same alerts is allowed: it is another destination.
  await page.getByLabel("Delivery channel").selectOption("push")
  await expect(hint).toHaveCount(0)
  await expect(subscribe).toBeEnabled()
  // Only the service knows whether this browser already holds them. Its refusal is explained too.
  await page.evaluate(() => {
    Notification.requestPermission = async () => "granted"
    const registration = { scope: location.origin + "/", active: { postMessage() {} },
      pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({ endpoint: "https://fcm.googleapis.com/local-test", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } }) }) } }
    Object.defineProperty(navigator.serviceWorker, "register", { value: async () => registration })
    Object.defineProperty(navigator.serviceWorker, "ready", { value: Promise.resolve(registration) })
  })
  refuse.subscribe = { status: 409, code: "duplicate" }
  await subscribe.click()
  await expect(page.getByRole("alert")).toHaveText("You already have a subscription with these same alerts on this channel. Change the selection, or use the existing one.")
  expect(subscriptions).toHaveLength(1)
})

test("creating a subscription shows its place at once, and an unavailable channel is explained", async ({ connectedPage: page }) => {
  const mock = await service(page, { telegram: false })
  await page.goto("/#/alerts")
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  // Telegram cannot link right now: the form says so instead of a button that is silently off.
  await expect(page.getByText("Telegram alerts are not available right now. Try again later, or use browser notifications.")).toBeVisible()
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeDisabled()
  await page.getByLabel("Delivery channel").selectOption("push")
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeEnabled()
  await page.evaluate(() => {
    Notification.requestPermission = async () => "granted"
    const registration = { scope: location.origin + "/", active: { postMessage() {} },
      pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({ endpoint: "https://fcm.googleapis.com/local-test", keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) } }) }) } }
    Object.defineProperty(navigator.serviceWorker, "register", { value: async () => registration })
    Object.defineProperty(navigator.serviceWorker, "ready", { value: Promise.resolve(registration) })
  })
  mock.delay = 800
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  // While the service works: the button says so, the form is off, and the new card holds its place.
  await expect(page.getByRole("button", { name: "Subscribing…" })).toBeDisabled()
  await expect(page.getByRole("status", { name: "Creating your subscription…" })).toBeVisible()
  await expect(page.getByText("You have no alert subscriptions.")).toHaveCount(0)
  await expect(page.getByRole("article")).toHaveCount(1)
  await expect(page.getByRole("status", { name: "Creating your subscription…" })).toHaveCount(0)
  await expect(page.getByRole("article").getByText("Not confirmed yet", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "Subscribe", exact: true })).toBeEnabled()
  // The next subscription holds its place too, under the card that is already there.
  await page.getByRole("checkbox", { name: "Rewards claimable", exact: true }).check()
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("status", { name: "Creating your subscription…" })).toBeVisible()
  await expect(page.getByRole("article")).toHaveCount(2)
  await expect(page.getByRole("status", { name: "Creating your subscription…" })).toHaveCount(0)
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
  await expect(card.getByText("Link expired", { exact: true })).toBeVisible()
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveCount(0)
  await card.getByRole("button", { name: "Get a new Telegram link" }).click()
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toHaveAttribute("href", "https://t.me/test_bot?start=reissued-1")
  await expect(card.getByRole("link", { name: "Open Telegram and press Start" })).toBeFocused() // The button that was focused has left the card.
  await expect(card.getByRole("status")).toHaveText(waiting)
  // After a reload the page has no link to show, so the card offers a new one.
  await page.reload()
  await page.getByRole("button", { name: "Sign to manage alerts" }).click()
  await expect(card.getByRole("status")).toHaveText(noLinkHere)
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
  await expect(card.getByRole("status")).toHaveText(noLinkHere)
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
  refuse.subscribe = { status: 429, code: "rate" }
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("Too many sign-in requests for this wallet. Wait five minutes, then sign again.")
  refuse.subscribe = { status: 403, code: "forbidden" }
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("alert")).toHaveText("The alerts service does not accept requests from this address of the site. Open the official site and try again.")
  delete refuse.subscribe
  await page.getByRole("button", { name: "Subscribe", exact: true }).click()
  await expect(page.getByRole("article")).toHaveCount(1)
  await expect(page.getByRole("alert")).toHaveCount(0)
  await page.getByRole("checkbox", { name: "Rewards claimable", exact: true }).check()
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
  await expect(card.getByRole("status")).toHaveText("Subscribed. Get a test notification: the browser you subscribed with should show it.")
  expect(subscriptions[0]!.channel).toBe("push")
  await card.getByRole("button", { name: "Get test notification" }).click()
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
