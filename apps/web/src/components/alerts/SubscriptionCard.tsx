import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { alertErrorCode, linkPending, type AlertErrorCode, type AlertSubscription, type TelegramLink } from "@/hooks/useAlerts"
import { alertErrorMessage } from "@/lib/alertMessages"
import { formatUtcDayLong } from "@/lib/format"

/** The current time, refreshed every `every` milliseconds while `active`. */
function useNow(active: boolean, every: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(timer)
  }, [active, every])
  return now
}

interface Actions {
  newLink: (id: string) => Promise<{ telegramUrl: string; expiresAt: string }>
  sendTest: (id: string) => Promise<unknown>
  setPaused: (id: string, paused: boolean) => Promise<unknown>
  remove: (id: string) => Promise<unknown>
  /** The user opened a Telegram link: the list is read at the fast rate from now. */
  watchLink: () => Promise<unknown>
}
type Pending = "link" | "test" | "pause" | "delete"

/** The place a subscription takes while the service creates it, at a card's size, so nothing moves when it arrives. */
export function SubscriptionCardSkeleton({ label }: { label: string }) {
  return <Skeleton aria-label={label} className="min-h-44 rounded-lg" />
}

/**
 * One subscription: what it watches, its state, one status line, and its own actions. `link` is
 * the Telegram link issued in this page session; the API never returns a link again, so after a
 * reload the card offers a new one. The card opens `link` only while the subscription's current
 * code is that link's own, by its expiry: a newer code makes this link dead.
 *
 * The status line and the note under it always hold their place, three lines and two on a narrow
 * screen, so the card keeps its height when it goes from waiting to connected, and when a result
 * appears, in every language of the interface.
 */
export function SubscriptionCard({ sub, triggers, link, focusLink, maxSubscriptions, fetchedAt, actions, onLink }: {
  sub: AlertSubscription
  triggers: ReactNode
  link: TelegramLink | undefined
  /** Move focus to the Telegram link once, after the subscription was created. */
  focusLink: boolean
  maxSubscriptions: number
  /** When `sub` was read. Its `testRetryAfter` seconds count from then, by this browser's clock. */
  fetchedAt: number
  actions: Actions
  /** Stores the new link. Resolves once the list shows that link's own expiry, so the card can open it. */
  onLink: (id: string, link: TelegramLink) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<{ code: AlertErrorCode; during: Pending } | null>(null)
  const [testSent, setTestSent] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [opened, setOpened] = useState(false)
  const busy = pending !== null
  const telegram = sub.channel === "telegram"
  const expired = sub.status === "expired"
  const unlinked = telegram && !sub.linked && !expired
  // Seconds for the test countdown; ten seconds are enough for the minutes left on a link. The
  // ticker rests while there is nothing to count, so the time is never taken as older than the list.
  const now = Math.max(fetchedAt, useNow(unlinked || sub.testRetryAfter > 0, sub.testRetryAfter > 0 ? 1000 : 10_000))
  const testWait = Math.max(0, Math.ceil((fetchedAt + sub.testRetryAfter * 1000 - now) / 1000))
  const linkAlive = linkPending(sub, now)
  const openLink = linkAlive && link?.expiresAt === sub.linkExpiresAt ? link.url : undefined

  // The card saw this subscription connect: it says so once, and the test button takes the focus
  // that the Telegram link, now gone, may have held.
  const [wasUnlinked, setWasUnlinked] = useState(unlinked)
  const [justLinked, setJustLinked] = useState(false)
  if (wasUnlinked !== unlinked) {
    setWasUnlinked(unlinked)
    if (wasUnlinked && sub.linked) setJustLinked(true)
  }
  const card = useRef<HTMLElement>(null)
  const anchor = useRef<HTMLAnchorElement>(null)
  const testButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // Only when the focus is nowhere or was in this card: never away from what the user is doing.
    const active = document.activeElement
    if (justLinked && (!active || active === document.body || card.current?.contains(active))) testButton.current?.focus()
  }, [justLinked])
  // The link takes the focus when it appears: after the subscription is created, and after
  // "Get a new Telegram link", whose button leaves the card.
  const [issuedHere, setIssuedHere] = useState(false)
  useEffect(() => {
    if ((focusLink || issuedHere) && openLink) anchor.current?.focus()
  }, [focusLink, issuedHere, openLink])

  const run = async (name: Pending, action: () => Promise<unknown>) => {
    setPending(name); setError(null); setTestSent(false); setJustLinked(false)
    try { await action() } catch (failure) { setError({ code: alertErrorCode(failure), during: name }) } finally { setPending(null) }
  }

  let state: { label: string; tone: "ok" | "wait" | "off" }
  let status: string
  if (expired) {
    state = { label: t("alerts.stateNotDelivering", "Not delivering"), tone: "off" }
    status = telegram
      ? t("alerts.statusTelegramBlocked", "Telegram no longer accepts messages for this chat. Delete this subscription and subscribe again.")
      : t("alerts.statusPushExpired", "The browser you subscribed with no longer accepts notifications. Delete this subscription and subscribe again.")
  } else if (unlinked) {
    // Telegram tells the service about Start at once, and this page reads the result every second
    // or two. A new link cancels the old one, so the card offers it only when it has none to open.
    if (openLink) {
      state = { label: t("alerts.stateWaiting", "Waiting for Start"), tone: "wait" }
      status = opened
        ? t("alerts.statusTelegramOpened", "Waiting for you to press Start in Telegram. This card updates as soon as you do.")
        : t("alerts.statusTelegramOpen", "Open Telegram and press Start. This card updates as soon as you do.")
    } else if (linkAlive) {
      state = { label: t("alerts.stateWaiting", "Waiting for Start"), tone: "wait" }
      status = t("alerts.statusTelegramNoLinkHere", "Not connected yet. If you just pressed Start, this card updates in a few seconds. If not, get a new Telegram link, open it and press Start.")
    } else {
      state = { label: t("alerts.stateLinkExpired", "Link expired"), tone: "off" }
      status = t("alerts.statusTelegramExpiredLink", "The Telegram link expired before Start was pressed. Get a new link, open it and press Start.")
    }
  } else if (sub.paused) {
    state = { label: t("alerts.pausedBadge", "Paused"), tone: "off" }
    status = t("alerts.statusPaused", "Paused. No alerts are sent until you resume.")
  } else if (telegram) {
    state = { label: t("alerts.stateConnected", "Connected"), tone: "ok" }
    status = sub.linkedAt
      ? t("alerts.statusTelegramConnectedSince", "Connected to Telegram since {{date}}.", { date: formatUtcDayLong(Date.parse(sub.linkedAt)) })
      : t("alerts.statusTelegramConnected", "Connected to Telegram.")
  } else if (sub.status === "verified") {
    state = { label: t("alerts.stateConnected", "Connected"), tone: "ok" }
    status = t("alerts.statusPushVerified", "Notifications reach the browser you subscribed with.")
  } else {
    state = { label: t("alerts.stateNotConfirmed", "Not confirmed yet"), tone: "wait" }
    status = t("alerts.statusPushUnverifiedTest", "Subscribed. Get a test notification: the browser you subscribed with should show it.")
  }

  // One line under the status: the latest result first, then what helps in the current state.
  let note: { text: string; role?: "alert" | "status" } | null = null
  if (error) note = { text: alertErrorMessage(t, error.code, maxSubscriptions, error.during === "test" ? "test" : undefined), role: "alert" }
  else if (testSent) note = { role: "status", text: telegram
    ? t("alerts.testSentTelegramNow", "Test notification sent. Check your Telegram chat.")
    : t("alerts.testSentPush", "Test notification sent. The browser you subscribed with should show it now.") }
  else if (justLinked) note = { role: "status", text: t("alerts.justLinked", "Telegram is connected. Get a test notification to see one arrive.") }
  else if (sub.paused && unlinked) note = { text: t("alerts.statusPaused", "Paused. No alerts are sent until you resume.") }
  else if (openLink) note = { text: t("alerts.linkMinutesLeft", "Minutes left on this link: {{minutes}}.", {
    minutes: Math.max(1, Math.ceil((Date.parse(sub.linkExpiresAt!) - now) / 60_000)) }) }
  else if (unlinked) note = { text: t("alerts.newLinkHint", "A new link cancels the previous one, and a Start already sent with it.") }

  const tones = { ok: "border-success/50 text-success", wait: "border-primary/50 text-foreground", off: "border-border text-muted-foreground" }
  return <article ref={card} className="rounded-lg border p-4 space-y-3" aria-busy={busy}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-medium">{telegram ? t("alerts.telegram", "Telegram") : t("alerts.browser", "Browser notifications")}</h3>
      <Badge variant="outline" className={tones[state.tone]}>
        {state.tone === "wait" && unlinked && <span aria-hidden className="mr-1.5 size-1.5 rounded-full bg-primary animate-pulse motion-reduce:animate-none" />}
        {state.label}
      </Badge>
    </div>
    {triggers}
    {/* Three lines on a phone, where the waiting status of the longer languages needs them. */}
    <p role="status" className="font-medium min-h-18 sm:min-h-6">{status}</p>
    {/* Keyed by its kind, so a new result is a new element and is announced. */}
    <p key={note?.role ?? "hint"} role={note?.role} className={`text-sm min-h-10 sm:min-h-5 ${note?.role === "alert" ? "text-destructive" : "text-muted-foreground"}`}>{note?.text}</p>
    {/* One button per row on a phone: the rows then do not depend on how long a label is in each language. */}
    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
      {openLink && <Button asChild>
        <a ref={anchor} href={openLink} target="_blank" rel="noreferrer" onClick={() => { setOpened(true); void actions.watchLink() }}>
          {opened ? t("alerts.linkTelegramAgain", "Open Telegram again") : t("alerts.linkTelegram", "Open Telegram and press Start")}
        </a>
      </Button>}
      {unlinked && !openLink && <Button disabled={busy}
        onClick={() => void run("link", async () => {
          const issued = await actions.newLink(sub.id)
          setOpened(false)
          setIssuedHere(true)
          // The button stays on "Getting a link…" until the card can open this link. Free earlier,
          // a second press would replace the code that was just issued.
          await onLink(sub.id, { url: issued.telegramUrl, expiresAt: issued.expiresAt })
        })}>
        {pending === "link" ? t("alerts.newLinkPending", "Getting a link…") : t("alerts.newLink", "Get a new Telegram link")}
      </Button>}
      {/* aria-disabled, not disabled: the button keeps the focus while it sends and counts down. */}
      {!expired && !unlinked && <Button ref={testButton} variant={sub.paused ? "outline" : "default"} aria-disabled={busy || testWait > 0}
        className="aria-disabled:opacity-50 aria-disabled:cursor-not-allowed"
        onClick={() => { if (!busy && testWait === 0) void run("test", async () => { await actions.sendTest(sub.id); setTestSent(true) }) }}>
        {pending === "test" ? t("alerts.testPending", "Sending…")
          : testWait > 0 ? t("alerts.testAgainInSeconds", "Test again in {{seconds}} sec", { seconds: testWait })
            : t("alerts.getTest", "Get test notification")}
      </Button>}
      {!expired && <Button variant="outline" disabled={busy} onClick={() => void run("pause", () => actions.setPaused(sub.id, !sub.paused))}>
        {sub.paused ? t("alerts.resume", "Resume") : t("alerts.pause", "Pause")}
      </Button>}
      {!confirmDelete && <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>{t("alerts.delete", "Delete subscription")}</Button>}
    </div>
    {confirmDelete && <div role="group" aria-label={t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")} className="space-y-2">
      <p>{t("alerts.deleteConfirm", "Delete this subscription? Its alerts stop at once.")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={busy} onClick={() => void run("delete", () => actions.remove(sub.id))}>
          {pending === "delete" ? t("alerts.deletePending", "Deleting…") : t("alerts.deleteYes", "Delete")}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => setConfirmDelete(false)}>{t("alerts.cancel", "Cancel")}</Button>
      </div>
    </div>}
  </article>
}
