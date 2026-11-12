import { createPublicClient, getAddress, http, isAddress, isHex, type Address, type Hex } from "viem"
import { createSiweMessage, parseSiweMessage } from "viem/siwe"
import { CHAINS, PUBLIC_RPC_URLS } from "@cobuilders/safenet-core"
import { Database, digest, randomToken } from "./db.js"
import { allowedOrigin } from "./origins.js"
import { HttpError, object, type Env } from "./types.js"

export function mainnetClient(env: Env) {
  return createPublicClient({ chain: CHAINS.mainnet, transport: http(env.MAINNET_RPC_URL || PUBLIC_RPC_URLS.mainnet[0], { timeout: 10_000, retryCount: 1 }) })
}
/** `origin` is the request's Origin header. The SIWE domain and URI name that origin, so the wallet can check it. */
export async function challenge(db: Database, env: Env, origin: string, input: unknown, now = Date.now()) {
  allowedOrigin(env, origin)
  const { wallet } = object(input)
  if (typeof wallet !== "string" || !isAddress(wallet)) throw new HttpError(400, "Invalid wallet")
  const address = getAddress(wallet)
  const expires = new Date(now + 5 * 60_000)
  const message = createSiweMessage({ address, chainId: CHAINS.mainnet.id,
    domain: new URL(origin).host, uri: origin, version: "1",
    statement: "Manage Safenet alert subscriptions. No transaction or custody permission.",
    nonce: randomToken().replace(/[-_]/g, ""), issuedAt: new Date(now), expirationTime: expires,
  })
  const id = await db.issueChallenge(address.toLowerCase(), message, expires.toISOString())
  if (!id) throw new HttpError(429, "Try again after the challenge window")
  return { id, message, expiresAt: expires.toISOString() }
}
export type VerifyWallet = (args: { address: Address; message: string; signature: Hex }) => Promise<boolean>
export async function verifyWallet(env: Env, args: Parameters<VerifyWallet>[0]) {
  const client = mainnetClient(env)
  if (await client.getChainId() !== CHAINS.mainnet.id) throw new Error("Authentication chain mismatch")
  return client.verifyMessage(args)
}
export async function authenticate(db: Database, env: Env, origin: string, input: unknown, verify: VerifyWallet = args => verifyWallet(env, args)) {
  allowedOrigin(env, origin)
  const { id, signature } = object(input)
  if (typeof id !== "string" || !/^[\da-f-]{36}$/i.test(id) || typeof signature !== "string" || !isHex(signature) || signature.length > 16384) {
    throw new HttpError(400, "Invalid signature")
  }
  const item = await db.challenge(id)
  if (!item || item.used || Date.parse(item.expires_at) <= Date.now()) throw new HttpError(401, "Challenge expired")
  // The stored message is the one the server issued and the wallet signed. Accept it only from the
  // origin it names. This is a consistency check: a non-browser client can forge Origin, and the
  // wallet's own domain check is what stops phishing. A mismatch leaves the challenge unused.
  let issued: ReturnType<typeof parseSiweMessage>
  try { issued = parseSiweMessage(item.message) } catch { issued = {} }
  if (issued.uri !== origin || issued.domain !== new URL(origin).host) throw new HttpError(401, "Challenge origin mismatch")
  // viem's public client verifies EOAs and deployed ERC-1271 wallets (including Safe).
  // Never recover an owner EOA and mistake it for proof of the Safe's threshold approval.
  if (!await verify({ address: item.wallet as Address, message: item.message, signature })) throw new HttpError(401, "Wallet verification failed")
  const token = randomToken()
  const accepted = await db.authenticate(id, await digest(token), await digest(signature))
  if (!accepted) throw new HttpError(401, "Challenge already used or expired")
  return { token, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
}
export async function session(db: Database, request: Request) {
  const token = request.headers.get("Authorization")?.match(/^Bearer ([\w-]{43})$/)?.[1]
  if (!token) throw new HttpError(401, "Sign to continue")
  const owner = await db.session(await digest(token))
  if (!owner) throw new HttpError(401, "Session expired")
  return owner
}
