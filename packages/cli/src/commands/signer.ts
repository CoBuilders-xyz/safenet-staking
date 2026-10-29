/**
 * Turning the signer options into a signer. This is the only place the CLI touches a key.
 *
 * - `--private-key-env <NAME>` reads the key from the environment variable NAME. The key never
 *   comes from a flag value, which would land in the shell history and in `ps`.
 * - `--keystore <path>` decrypts a version 3 keystore file. The password comes from a prompt
 *   that does not echo, or from the variable named by `--password-env`.
 *
 * No message here prints a key, a password, the value of a variable, or the name given for one:
 * a user who types the secret where its variable's name belongs must not see it echoed.
 */
import { readFile } from "node:fs/promises"
import { privateKeyToAccount } from "viem/accounts"
import type { Address, Hex } from "viem"
import { decryptKeystore, localSigner, SafenetError, type Context, type Signer } from "../lib/index.js"
import { createWalletBridge, walletConnectSigner, type WalletInteraction } from "./walletconnect.js"
import { UsageError } from "./options.js"

export type SignerRequest =
  | { readonly kind: "walletconnect"; readonly address: Address }
  | { readonly kind: "private-key-env"; readonly name: string }
  | { readonly kind: "keystore"; readonly path: string; readonly passwordEnv: string | null }

export interface SignerSources {
  readonly wallet?: WalletInteraction
  readonly env: Readonly<Record<string, string | undefined>>
  /** Asks for a password without echoing it. Undefined when there is no terminal to ask in. */
  readonly askPassword: ((prompt: string) => Promise<string>) | undefined
}

function privateKeyFrom(value: string): Hex {
  const key = value.trim()
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    throw new UsageError("The variable named by --private-key-env does not hold a private key: expected 64 hex digits, with or without 0x")
  }
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex
}

async function keystoreKey(request: Extract<SignerRequest, { kind: "keystore" }>, sources: SignerSources): Promise<Hex> {
  let text: string
  try {
    text = await readFile(request.path, "utf8")
  } catch {
    throw new UsageError("Could not read the keystore file")
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new UsageError("The keystore file is not JSON")
  }
  let password: string
  if (request.passwordEnv) {
    const value = sources.env[request.passwordEnv]
    if (value === undefined) throw new UsageError("The environment variable named by --password-env is not set")
    password = value
  } else if (sources.askPassword) {
    password = await sources.askPassword("Keystore password: ")
  } else {
    throw new UsageError("--keystore needs its password: run it in a terminal, or pass --password-env <NAME>")
  }
  return decryptKeystore(json, password)
}

export async function loadSigner(request: SignerRequest, ctx: Context, sources: SignerSources): Promise<Signer> {
  if (request.kind === "walletconnect") {
    if (!sources.wallet) throw new UsageError("WalletConnect needs an interactive terminal; use --dry-run --from for automation")
    const projectId = sources.env.WALLETCONNECT_PROJECT_ID
    if (!projectId || !/^[a-f0-9]{32}$/i.test(projectId)) throw new UsageError("Set WALLETCONNECT_PROJECT_ID to a valid project ID")
    let bridge
    try { bridge = await createWalletBridge(projectId, sources.wallet.signal) }
    catch (err) {
      if (err instanceof SafenetError) throw err
      throw new SafenetError("WalletConnect could not initialize; check the project ID and connection")
    }
    return walletConnectSigner(ctx, request.address, bridge, sources.wallet)
  }
  let key: Hex
  if (request.kind === "private-key-env") {
    const value = sources.env[request.name]
    if (value === undefined || value === "") {
      throw new UsageError("The environment variable named by --private-key-env is not set")
    }
    key = privateKeyFrom(value)
  } else {
    key = await keystoreKey(request, sources)
  }
  try {
    return localSigner(ctx.client, privateKeyToAccount(key))
  } catch {
    throw new SafenetError("The private key is not a valid secp256k1 key")
  }
}
