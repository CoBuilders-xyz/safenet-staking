import { afterEach, describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"
import type { TFunction } from "i18next"
import { SubscriptionCard } from "../alerts/SubscriptionCard"
import { AlertError, LINK_POLL_FAST, LINK_POLL_SLOW, LIST_POLL, listPollInterval, type AlertErrorCode, type AlertSubscription, type TelegramLink } from "@/hooks/useAlerts"
import { alertErrorMessage } from "@/lib/alertMessages"
import { i18n } from "@/i18n"

const NOW = Date.parse("2026-11-13T20:00:00.000Z")
const inMinutes = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString()
const pending: AlertSubscription = { id: "sub", triggers: ["cooldown"], participation: 75, missed: 3, channel: "telegram", status: "unverified",
  linked: false, linkedAt: null, linkExpiresAt: inMinutes(10), paused: false, lastDelivery: null, testRetryAfter: 0 }
const linked: AlertSubscription = { ...pending, linked: true, linkedAt: "2026-11-13T19:00:00.000Z", linkExpiresAt: null }
const link: TelegramLink = { url: "https://t.me/test_bot?start=code", expiresAt: pending.linkExpiresAt! }

function actions() {
  return {
    newLink: vi.fn().mockResolvedValue({ telegramUrl: "https://t.me/test_bot?start=new", expiresAt: inMinutes(10) }),
    sendTest: vi.fn().mockResolvedValue({ sent: true, retryAfter: 60 }),
    setPaused: vi.fn().mockResolvedValue({ paused: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    watchLink: vi.fn().mockResolvedValue(undefined),
  }
}
function setup(sub: AlertSubscription, options: { link?: TelegramLink; fetchedAt?: number } = {}) {
  const calls = actions()
  const onLink = vi.fn()
  const props = (current: AlertSubscription, fetchedAt = options.fetchedAt ?? NOW) => <SubscriptionCard sub={current} triggers={null} link={options.link}
    focusLink={false} maxSubscriptions={10} fetchedAt={fetchedAt} actions={calls} onLink={onLink} />
  const view = render(props(sub))
  return { calls, onLink, update: (current: AlertSubscription, fetchedAt?: number) => view.rerender(props(current, fetchedAt)) }
}
const status = () => screen.getAllByRole("status")[0]!

describe("SubscriptionCard", () => {
  afterEach(() => vi.useRealTimers())
  const clock = () => { vi.useFakeTimers(); vi.setSystemTime(NOW) }

  it("waits for Start with the link, then says it is waiting once Telegram was opened", () => {
    clock()
    const { calls } = setup(pending, { link })
    expect(status()).toHaveTextContent("Open Telegram and press Start. This card updates as soon as you do.")
    expect(screen.getByText("Waiting for Start")).toBeInTheDocument()
    expect(screen.getByText("Minutes left on this link: 10.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Get test notification" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Get a new Telegram link" })).toBeNull()
    const open = screen.getByRole("link", { name: "Open Telegram and press Start" })
    expect(open).toHaveAttribute("href", link.url)
    expect(open).toHaveAttribute("target", "_blank")
    fireEvent.click(open)
    // The page reads the list at the fast rate from the moment the link is opened.
    expect(calls.watchLink).toHaveBeenCalledOnce()
    expect(status()).toHaveTextContent("Waiting for you to press Start in Telegram. This card updates as soon as you do.")
    expect(screen.getByRole("link", { name: "Open Telegram again" })).toHaveAttribute("href", link.url)
  })

  it("offers a new link when it has none to open, and when the link expired", async () => {
    clock()
    const { calls, onLink, update } = setup(pending)
    expect(status()).toHaveTextContent("Not connected yet. If you just pressed Start, this card updates in a few seconds. If not, get a new Telegram link, open it and press Start.")
    expect(screen.getByText("A new link cancels the previous one, and a Start already sent with it.")).toBeInTheDocument()
    // The link's time runs out while the card is shown.
    update({ ...pending, linkExpiresAt: inMinutes(1) })
    act(() => { vi.advanceTimersByTime(70_000) })
    expect(status()).toHaveTextContent("The Telegram link expired before Start was pressed. Get a new link, open it and press Start.")
    expect(screen.getByText("Link expired")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Get a new Telegram link" }))
    expect(screen.getByRole("button", { name: "Getting a link…" })).toBeDisabled()
    await act(async () => { await vi.runOnlyPendingTimersAsync() })
    expect(calls.newLink).toHaveBeenCalledWith("sub")
    expect(onLink).toHaveBeenCalledWith("sub", { url: "https://t.me/test_bot?start=new", expiresAt: inMinutes(10) })
  })

  it("an old link is not offered for a newer code", () => {
    clock()
    setup({ ...pending, linkExpiresAt: inMinutes(9) }, { link })
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByRole("button", { name: "Get a new Telegram link" })).toBeEnabled()
  })

  it("says Connected when Start arrives, and gives the focus to the test button", () => {
    clock()
    const { update } = setup(pending, { link })
    screen.getByRole("link", { name: "Open Telegram and press Start" }).focus()
    update(linked)
    expect(status()).toHaveTextContent("Connected to Telegram since 13 November 2026.")
    expect(screen.getByText("Connected")).toBeInTheDocument()
    expect(screen.getByText("Telegram is connected. Get a test notification to see one arrive.")).toHaveAttribute("role", "status")
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.getByRole("button", { name: "Get test notification" })).toHaveFocus()
  })

  it("does not take the focus from another control when Start arrives", () => {
    clock()
    const outside = document.createElement("input")
    document.body.append(outside)
    try {
      const { update } = setup(pending, { link })
      outside.focus()
      update(linked)
      expect(outside).toHaveFocus()
    } finally { outside.remove() }
  })

  it("a card that was connected when the page opened says nothing about just connecting", () => {
    clock()
    setup(linked)
    expect(screen.queryByText("Telegram is connected. Get a test notification to see one arrive.")).toBeNull()
    expect(screen.getAllByRole("status")).toHaveLength(1)
  })

  it("sends a test once, says it was sent, and counts down the minute from the list's seconds", async () => {
    clock()
    let finish: (value: unknown) => void = () => {}
    const { calls, update } = setup(linked)
    calls.sendTest.mockReturnValue(new Promise(resolve => { finish = resolve }))
    const button = screen.getByRole("button", { name: "Get test notification" })
    button.focus()
    fireEvent.click(button)
    // In flight: the button says so, stays focusable, and a second press sends nothing.
    const sending = screen.getByRole("button", { name: "Sending…" })
    expect(sending).toHaveAttribute("aria-disabled", "true")
    expect(sending).not.toBeDisabled()
    fireEvent.click(sending)
    expect(calls.sendTest).toHaveBeenCalledOnce()
    // The service answers, and the refreshed list carries the seconds until the next test.
    await act(async () => { finish({ sent: true, retryAfter: 60 }); await Promise.resolve() })
    update({ ...linked, testRetryAfter: 60 }, NOW)
    expect(screen.getByText("Test notification sent. Check your Telegram chat.")).toHaveAttribute("role", "status")
    const waiting = screen.getByRole("button", { name: "Test again in 60 s" })
    expect(waiting).toHaveAttribute("aria-disabled", "true")
    expect(waiting).toHaveFocus()
    fireEvent.click(waiting)
    expect(calls.sendTest).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(screen.getByRole("button", { name: "Test again in 45 s" })).toBeInTheDocument()
    // The minute ends: the button is back without waiting for the next read of the list.
    act(() => { vi.advanceTimersByTime(45_000) })
    expect(screen.getByRole("button", { name: "Get test notification" })).toHaveAttribute("aria-disabled", "false")
  })

  it("never counts from a clock older than the list: a card that rested starts at the list's seconds", () => {
    clock()
    const { update } = setup(linked)
    // Five minutes pass with nothing to count, so the card's own clock rests.
    vi.setSystemTime(NOW + 5 * 60_000)
    update({ ...linked, testRetryAfter: 42 }, NOW + 5 * 60_000)
    expect(screen.getByRole("button", { name: "Test again in 42 s" })).toBeInTheDocument()
  })

  it.each([
    ["delivery", "The test notification could not be delivered. Nothing changed in your subscription. Try again in a minute."],
    ["rate", "One test notification per minute for each subscription. Wait for the countdown, then try again."],
    ["expired", "This subscription can no longer deliver. Delete it and subscribe again."],
    ["not_linked", "Connect Telegram first: get a link, open it and press Start."],
    ["session", "Your session expired. Sign again to continue."],
    ["network", "The alerts service did not answer. Check your connection and try again."],
  ] as const)("a failed test says why: %s", async (code, message) => {
    const { calls } = setup(linked)
    calls.sendTest.mockRejectedValue(new AlertError(code))
    fireEvent.click(screen.getByRole("button", { name: "Get test notification" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(message)
    expect(screen.queryByText("Test notification sent. Check your Telegram chat.")).toBeNull()
    // The button is not stuck on "Sending…". The countdown, if any, comes with the next read of the list.
    expect(screen.getByRole("button", { name: "Get test notification" })).toHaveAttribute("aria-disabled", "false")
  })

  it("shows what cannot deliver, and what is paused or not confirmed, with one state each", () => {
    const { update } = setup({ ...linked, status: "expired" })
    expect(status()).toHaveTextContent("Telegram no longer accepts messages for this chat. Delete this subscription and subscribe again.")
    expect(screen.getByText("Not delivering")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Get test notification" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull()
    update({ ...linked, paused: true })
    expect(status()).toHaveTextContent("Paused. No alerts are sent until you resume.")
    expect(screen.getByRole("button", { name: "Resume" })).toBeEnabled()
    update({ ...linked, channel: "push", linkedAt: null })
    expect(status()).toHaveTextContent("Subscribed. Get a test notification: the browser you subscribed with should show it.")
    expect(screen.getByText("Not confirmed yet")).toBeInTheDocument()
    update({ ...linked, channel: "push", linkedAt: null, status: "verified" })
    expect(status()).toHaveTextContent("Notifications reach the browser you subscribed with.")
  })

  it("deletes only after a confirmation", async () => {
    const { calls } = setup(linked)
    fireEvent.click(screen.getByRole("button", { name: "Delete subscription" }))
    expect(calls.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    fireEvent.click(screen.getByRole("button", { name: "Delete subscription" }))
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete" })) })
    expect(calls.remove).toHaveBeenCalledWith("sub")
  })
})

describe("how often the list is read", () => {
  it("reads fast while a link can complete and the user just acted, slower after, and rarely otherwise", () => {
    expect(listPollInterval([pending], NOW, NOW + 1000)).toBe(LINK_POLL_FAST)
    expect(listPollInterval([linked, pending], NOW, NOW + 1000)).toBe(LINK_POLL_FAST)
    expect(listPollInterval([pending], NOW, NOW - 1)).toBe(LINK_POLL_SLOW)
    expect(listPollInterval([linked], NOW, NOW + 1000)).toBe(LIST_POLL)
    expect(listPollInterval([{ ...pending, linkExpiresAt: inMinutes(-1) }], NOW, NOW + 1000)).toBe(LIST_POLL)
    expect(listPollInterval([{ ...pending, status: "expired" }], NOW, NOW + 1000)).toBe(LIST_POLL)
    expect(listPollInterval(undefined, NOW, NOW + 1000)).toBe(LIST_POLL)
    expect(LINK_POLL_FAST).toBeLessThanOrEqual(2000) // "Within a couple of seconds of Start."
  })
})

describe("alert error messages", () => {
  const t = i18n.t.bind(i18n) as TFunction
  const codes: AlertErrorCode[] = ["invalid", "session", "forbidden", "not_found", "limit", "duplicate", "linked", "not_linked", "expired", "rate", "delivery",
    "telegram_unavailable", "push_unavailable", "unavailable", "network", "signature", "rejected", "permission", "unsupported", "push"]

  it("every code has its own message, and none is the generic one except the outage", () => {
    const messages = codes.map(code => alertErrorMessage(t, code, 10))
    expect(new Set(messages).size).toBe(codes.length)
    const generic = alertErrorMessage(t, "unavailable", 10)
    expect(messages.filter(message => message === generic)).toHaveLength(1)
    for (const message of messages) expect(message).toMatch(/\.$/)
  })

  it("names the limit that refused the request", () => {
    expect(alertErrorMessage(t, "rate", 10)).toBe("Too many sign-in requests for this wallet. Wait five minutes, then sign again.")
    expect(alertErrorMessage(t, "rate", 10, "test")).toBe("One test notification per minute for each subscription. Wait for the countdown, then try again.")
    expect(alertErrorMessage(t, "limit", 4)).toBe("You have 4 subscriptions, the maximum. Delete one to add another.")
  })
})
