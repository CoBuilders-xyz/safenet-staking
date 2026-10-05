/**
 * Turning the signer settings into a signer, the same two ways the CLI signs: a private key read
 * from the environment variable the operator named, or a version 3 keystore decrypted with the
 * password in the variable named for it. This is the only place the server touches a key.
 *
 * While writes are on, it runs for every write call, dry runs included, because a dry run
 * simulates from the signer's address. It keeps nothing. No message here prints a key, a password, the
 * value of a variable, the name given for one, or the keystore path.
 */
import { readFile } from "node:fs/promises"
import { privateKeyToAccount } from "viem/accounts"
import type { Hex } from "viem"
import { decryptKeystore, localSigner, SafenetError, type Context, type Signer } from "@cobuilders/safenet-cli/lib"
import type { SignerRequest } from "./config.js"

type Env = Readonly<Record<string, string | undefined>>

export type LoadSigner = (request: SignerRequest, ctx: Context) => Promise<Signer>

function privateKeyFrom(value: string): Hex {
  const key = value.trim()
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) {
    throw new SafenetError("The variable named by SAFENET_MCP_PRIVATE_KEY_ENV does not hold a private key: expected 64 hex digits, with or without 0x")
  }
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex
}

async function keystoreKey(request: Extract<SignerRequest, { kind: "keystore" }>, env: Env): Promise<Hex> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(request.path, "utf8"))
  } catch {
    throw new SafenetError("Could not read the keystore file named by SAFENET_MCP_KEYSTORE as JSON")
  }
  const password = env[request.passwordEnv]
  if (password === undefined) throw new SafenetError("The environment variable named by SAFENET_MCP_PASSWORD_ENV is not set")
  return decryptKeystore(json, password)
}

export function signerLoader(env: Env): LoadSigner {
  return async (request, ctx) => {
    let key: Hex
    if (request.kind === "private-key-env") {
      const value = env[request.name]
      if (value === undefined || value === "") {
        throw new SafenetError("The environment variable named by SAFENET_MCP_PRIVATE_KEY_ENV is not set")
      }
      key = privateKeyFrom(value)
    } else {
      key = await keystoreKey(request, env)
    }
    try {
      return localSigner(ctx.client, privateKeyToAccount(key))
    } catch {
      throw new SafenetError("The private key is not a valid secp256k1 key")
    }
  }
}
