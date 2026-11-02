import { createPublicClient, getAddress, http, isAddress, isHex, type Address, type Hex } from "viem"
import { createSiweMessage } from "viem/siwe"
import { CHAINS, PUBLIC_RPC_URLS } from "@cobuilders/safenet-core"
import { Database, digest, randomToken } from "./db.js"
import { HttpError, object, type Env } from "./types.js"

export function mainnetClient(env: Env) {
  return createPublicClient({ chain: CHAINS.mainnet, transport: http(env.MAINNET_RPC_URL || PUBLIC_RPC_URLS.mainnet[0], { timeout: 10_000, retryCount: 1 }) })
}
export async function challenge(db: Database, env: Env, input: unknown, now = Date.now()) {
  const { wallet } = object(input)
  if (typeof wallet !== "string" || !isAddress(wallet)) throw new HttpError(400, "Invalid wallet")
  const address = getAddress(wallet)
  const expires = new Date(now + 5 * 60_000)
  const message = createSiweMessage({ address, chainId: CHAINS.mainnet.id,
    domain: new URL(env.APP_ORIGIN).host, uri: env.APP_ORIGIN, version: "1",
    statement: "Manage Safenet alert subscriptions. No transaction or custody permission.",
    nonce: randomToken().replace(/[-_]/g, ""), issuedAt: new Date(now), expirationTime: expires,
  })
  const rows = await db.rpc<{ id: string }[]>("issue_challenge", {
    owner_wallet: address.toLowerCase(), signed_message: message, expiry: expires.toISOString(),
  })
  if (!rows[0]) throw new HttpError(429, "Try again after the challenge window")
  return { id: rows[0].id, message, expiresAt: expires.toISOString() }
}
export type VerifyWallet = (args: { address: Address; message: string; signature: Hex }) => Promise<boolean>
export async function verifyWallet(env: Env, args: Parameters<VerifyWallet>[0]) {
  const client = mainnetClient(env)
  if (await client.getChainId() !== CHAINS.mainnet.id) throw new Error("Authentication chain mismatch")
  return client.verifyMessage(args)
}
export async function authenticate(db: Database, env: Env, input: unknown, verify: VerifyWallet = args => verifyWallet(env, args)) {
  const { id, signature } = object(input)
  if (typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id) || typeof signature !== "string" || !isHex(signature) || signature.length > 16384) {
    throw new HttpError(400, "Invalid signature")
  }
  const rows = await db.request<{ wallet: Address; message: string; expires_at: string; used: boolean }[]>(`alerts_challenges?id=eq.${id}&limit=1`)
  const item = rows[0]
  if (!item || item.used || Date.parse(item.expires_at) <= Date.now()) throw new HttpError(401, "Challenge expired")
  // viem's public client verifies EOAs and deployed ERC-1271 wallets (including Safe).
  // Never recover an owner EOA and mistake it for proof of the Safe's threshold approval.
  if (!await verify({ address: item.wallet, message: item.message, signature })) throw new HttpError(401, "Wallet verification failed")
  const token = randomToken()
  const accepted = await db.rpc<boolean>("authenticate", { challenge: id, token: await digest(token), signature: await digest(signature) })
  if (!accepted) throw new HttpError(401, "Challenge already used or expired")
  return { token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
}
export async function session(db: Database, request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([\w-]{43})$/)?.[1]
  if (!token) throw new HttpError(401, "Sign to continue")
  const rows = await db.request<{ wallet: string; signature_hash: string }[]>(
    `alerts_sessions?token_hash=eq.${await digest(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`)
  if (!rows[0]) throw new HttpError(401, "Session expired")
  return rows[0]
}
