import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useSignMessage } from "wagmi"
import type { Address } from "viem"

export type AlertTrigger = "cooldown" | "rewards" | "deregistered" | "participation" | "missed"
export interface AlertSubscription {
  id: string
  triggers: AlertTrigger[]
  participation: number
  missed: number
  channel: "telegram" | "push"
  status: "unverified" | "verified" | "expired"
  linked: boolean
  /** When the Telegram chat was linked. Null for a browser, and for a chat linked before this was recorded. */
  linkedAt: string | null
  /** When the pending Telegram link stops working. Null when linked, or when no link is left. */
  linkExpiresAt: string | null
  paused: boolean
  lastDelivery: string | null
}
/** Why a request failed. The API sends most of these as `code`; the rest arise in the browser. */
const errorCodes = ["invalid", "session", "forbidden", "not_found", "limit", "linked", "not_linked", "expired", "rate", "delivery",
  "telegram_unavailable", "push_unavailable", "unavailable", "network", "signature", "rejected", "permission", "unsupported", "push"] as const
export type AlertErrorCode = typeof errorCodes[number]
export class AlertError extends Error {
  readonly code: AlertErrorCode
  constructor(code: AlertErrorCode) { super(code); this.code = code }
}
export const alertErrorCode = (error: unknown): AlertErrorCode => error instanceof AlertError ? error.code : "unavailable"
export const alertsApi = import.meta.env.VITE_ALERTS_API_URL?.replace(/\/$/, "")
export async function alertRequest<T>(path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  if (!alertsApi) throw new AlertError("unavailable")
  let response: Response
  try {
    response = await fetch(`${alertsApi}${path}`, {
      method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    })
  } catch { throw new AlertError("network") }
  if (!response.ok) {
    const code = await response.json().then((answer: { code?: unknown }) => answer.code, () => undefined)
    throw new AlertError(errorCodes.find(known => known === code) ?? (response.status === 401 ? "session" : "unavailable"))
  }
  return response.json() as Promise<T>
}

/** Mounted with wallet address as key. Tokens stay in memory and leave on disconnect/switch. */
export function useAlerts(address: Address) {
  const [session, setSession] = useState<{ token: string; expiresAt: string } | null>(null)
  const pendingSignature = useRef<{ id: string; signature: string; expiresAt: string } | null>(null)
  const [pendingVerification, setPendingVerification] = useState(false)
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const config = useQuery({ queryKey: ["alertsConfig"], queryFn: () => alertRequest<{ vapidPublicKey: string | null; telegramBot: string | null; maxSubscriptions?: number }>("/config"), enabled: !!alertsApi, retry: false })
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => setSession(null), Math.max(0, Date.parse(session.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [session])
  const token = session?.token
  const subscriptions = useQuery({
    queryKey: ["alerts", address, token], enabled: !!token, retry: false, gcTime: 0,
    queryFn: () => alertRequest<AlertSubscription[]>("/subscriptions", token),
    // The Worker links a Telegram chat on its next Cron run, so poll faster while a link can still
    // complete. Once the link has expired the fast poll stops, and the card says what to do.
    refetchInterval: query => query.state.data?.some(sub => linkPending(sub, Date.now())) ? 10_000 : 15_000,
  })
  const sign = async () => {
    let pending = pendingSignature.current
    if (!pending || Date.parse(pending.expiresAt) <= Date.now()) {
      const challenge = await alertRequest<{ id: string; message: string; expiresAt: string }>("/auth/challenge", undefined, { wallet: address })
      const signature = await signMessageAsync({ message: challenge.message }).catch(() => { throw new AlertError("rejected") })
      pending = { id: challenge.id, signature, expiresAt: challenge.expiresAt }
      pendingSignature.current = pending
      setPendingVerification(true)
    }
    // A Safe may need other owners' approvals. Retry the SAME message while its challenge lives.
    setSession(await alertRequest<{ token: string; expiresAt: string }>("/auth/verify", undefined, { id: pending.id, signature: pending.signature })
      .catch(error => { throw alertErrorCode(error) === "session" ? new AlertError("signature") : error }))
    pendingSignature.current = null
    setPendingVerification(false)
  }
  const refresh = () => client.invalidateQueries({ queryKey: ["alerts", address] })
  const remove = async (id: string) => { await alertRequest(`/subscriptions/${id}`, token, undefined, "DELETE"); await refresh() }
  const action = async <T,>(id: string, name: "telegram-link" | "pause" | "resume" | "test") => {
    // A refusal can mean the list is out of date (already linked, expired, deleted), so refresh either way.
    try { return await alertRequest<T>(`/subscriptions/${id}/${name}`, token, undefined, "POST") } finally { await refresh() }
  }
  /** A new Telegram link for a subscription that has no chat yet. It replaces the previous link. */
  const newLink = (id: string) => action<{ telegramUrl: string; expiresAt: string }>(id, "telegram-link")
  const sendTest = (id: string) => action<{ sent: true }>(id, "test")
  const setPaused = (id: string, paused: boolean) => action<{ paused: boolean }>(id, paused ? "pause" : "resume")
  return { config, subscriptions, token, sign, refresh, remove, newLink, sendTest, setPaused, pendingVerification }
}
/** A Telegram subscription whose link can still complete: no chat yet, and the link has not expired. */
export function linkPending(sub: AlertSubscription, now: number): boolean {
  return sub.channel === "telegram" && !sub.linked && sub.status !== "expired" && !!sub.linkExpiresAt && Date.parse(sub.linkExpiresAt) > now
}

/** Registers this browser for push. A browser failure with no cause of its own is reported as "push". */
export async function browserChannel(vapidKey: string) {
  try { return await registerBrowser(vapidKey) } catch (error) { throw error instanceof AlertError ? error : new AlertError("push") }
}
async function registerBrowser(vapidKey: string) {
  if (!isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new AlertError("unsupported")
  if (await Notification.requestPermission() !== "granted") throw new AlertError("permission")
  const base = import.meta.env.BASE_URL
  const registration = await navigator.serviceWorker.register(`${base}alerts-sw.js`, { scope: base })
  const ready = await navigator.serviceWorker.ready
  if (ready.scope !== registration.scope) throw new AlertError("push")
  ready.active?.postMessage({ type: "alerts-config", api: alertsApi })
  const key = Uint8Array.from(atob(vapidKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))
  let subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const existing = subscription.options.applicationServerKey
    const matches = existing !== null && existing.byteLength === key.byteLength
      && new Uint8Array(existing).every((byte, index) => byte === key[index])
    if (!matches) {
      if (!await subscription.unsubscribe()) throw new AlertError("push")
      subscription = null
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys) throw new AlertError("push")
  return { kind: "push", endpoint: json.endpoint, keys: json.keys }
}
