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
  lastDelivery: string | null
}
export const alertsApi = import.meta.env.VITE_ALERTS_API_URL?.replace(/\/$/, "")
export async function alertRequest<T>(path: string, token?: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<T> {
  if (!alertsApi) throw new Error("Alerts unavailable")
  const response = await fetch(`${alertsApi}${path}`, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(response.status === 401 ? "session" : "service")
  return response.json() as Promise<T>
}

/** Mounted with wallet address as key. Tokens stay in memory and leave on disconnect/switch. */
export function useAlerts(address: Address) {
  const [session, setSession] = useState<{ token: string; expiresAt: string } | null>(null)
  const pendingSignature = useRef<{ id: string; signature: string; expiresAt: string } | null>(null)
  const [pendingVerification, setPendingVerification] = useState(false)
  const { signMessageAsync } = useSignMessage()
  const client = useQueryClient()
  const config = useQuery({ queryKey: ["alertsConfig"], queryFn: () => alertRequest<{ vapidPublicKey: string | null; telegramBot: string | null }>("/config"), enabled: !!alertsApi, retry: false })
  useEffect(() => {
    if (!session) return
    const timer = setTimeout(() => setSession(null), Math.max(0, Date.parse(session.expiresAt) - Date.now()))
    return () => clearTimeout(timer)
  }, [session])
  const token = session?.token
  const subscriptions = useQuery({
    queryKey: ["alerts", address, token], enabled: !!token, retry: false, gcTime: 0,
    queryFn: () => alertRequest<AlertSubscription[]>("/subscriptions", token),
    // The Worker links a Telegram chat on its next Cron run, so poll faster while a link is pending.
    refetchInterval: query => query.state.data?.some(sub => sub.channel === "telegram" && !sub.linked) ? 10_000 : 15_000,
  })
  const sign = async () => {
    let pending = pendingSignature.current
    if (!pending || Date.parse(pending.expiresAt) <= Date.now()) {
      const challenge = await alertRequest<{ id: string; message: string; expiresAt: string }>("/auth/challenge", undefined, { wallet: address })
      const signature = await signMessageAsync({ message: challenge.message })
      pending = { id: challenge.id, signature, expiresAt: challenge.expiresAt }
      pendingSignature.current = pending
      setPendingVerification(true)
    }
    // A Safe may need other owners' approvals. Retry the SAME message while its challenge lives.
    setSession(await alertRequest("/auth/verify", undefined, { id: pending.id, signature: pending.signature }))
    pendingSignature.current = null
    setPendingVerification(false)
  }
  const refresh = () => client.invalidateQueries({ queryKey: ["alerts", address] })
  const remove = async (id: string) => { await alertRequest(`/subscriptions/${id}`, token, undefined, "DELETE"); await refresh() }
  return { config, subscriptions, token, sign, refresh, remove, pendingVerification }
}

export async function browserChannel(vapidKey: string) {
  if (!isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error("unsupported")
  if (await Notification.requestPermission() !== "granted") throw new Error("permission")
  const base = import.meta.env.BASE_URL
  const registration = await navigator.serviceWorker.register(`${base}alerts-sw.js`, { scope: base })
  const ready = await navigator.serviceWorker.ready
  if (ready.scope !== registration.scope) throw new Error("scope")
  ready.active?.postMessage({ type: "alerts-config", api: alertsApi })
  const key = Uint8Array.from(atob(vapidKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))
  let subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    const existing = subscription.options.applicationServerKey
    const matches = existing !== null && existing.byteLength === key.byteLength
      && new Uint8Array(existing).every((byte, index) => byte === key[index])
    if (!matches) {
      if (!await subscription.unsubscribe()) throw new Error("push")
      subscription = null
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  const json = subscription.toJSON()
  if (!json.endpoint || !json.keys) throw new Error("push")
  return { kind: "push", endpoint: json.endpoint, keys: json.keys }
}
