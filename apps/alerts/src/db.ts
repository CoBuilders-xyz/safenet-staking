import type { Env } from "./types.js"

export class Database {
  constructor(private env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_KEY">, private transport: typeof fetch = fetch) {}
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const transport = this.transport
    const response = await transport(`${this.env.SUPABASE_URL}/rest/v1/${path}`, {
      method, headers: {
        apikey: this.env.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${this.env.SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json", Prefer: "return=representation",
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    })
    // Never propagate upstream bodies: they can contain personal data or credentials.
    if (!response.ok) throw new Error(`Database operation failed (${response.status})`)
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  rpc<T>(name: string, body: unknown) { return this.request<T>(`rpc/alerts_${name}`, "POST", body) }
}
export async function digest(value: string): Promise<string> {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex")
}
export const randomToken = () => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")
