/**
 * What the operator decides when the server starts, read from the environment once.
 *
 * Writes are off unless `SAFENET_MCP_ALLOW_WRITES=1` and a signer option are both set. The
 * signer options name where the key is, never the key: `SAFENET_MCP_PRIVATE_KEY_ENV` names a
 * variable that holds it, `SAFENET_MCP_KEYSTORE` is a keystore path and
 * `SAFENET_MCP_PASSWORD_ENV` names the variable that holds its password. No message here repeats
 * a value or the name given for a variable, which could be the secret typed in its place.
 */
import { existsSync } from "node:fs"

export type SignerRequest =
  | { readonly kind: "private-key-env"; readonly name: string }
  | { readonly kind: "keystore"; readonly path: string; readonly passwordEnv: string }

export type Writes =
  | { readonly allowed: true; readonly signer: SignerRequest }
  | { readonly allowed: false; readonly reason: string }

export interface ServerConfig {
  /** SAFENET_MCP_RPC_URL. Undefined leaves the library to MAINNET_RPC_URL, then core's public list. */
  readonly rpcUrl: string | undefined
  readonly githubToken: string | undefined
  readonly writes: Writes
  /** Lines for stderr at start: settings that have no effect, said once. */
  readonly notices: readonly string[]
}

/** A setting that stops the server from starting. */
export class ConfigError extends Error {
  override readonly name = "ConfigError"
}

type Env = Readonly<Record<string, string | undefined>>

const set = (v: string | undefined): v is string => v !== undefined && v !== ""

function variableName(env: Env, setting: string): string | undefined {
  const value = env[setting]
  if (!set(value)) return undefined
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value) || /^(0x)?[0-9a-fA-F]{40,}$/.test(value)) {
    throw new ConfigError(`${setting} takes the name of an environment variable that holds the secret, never the secret itself`)
  }
  return value
}

function signerRequest(env: Env): SignerRequest | null {
  const keyEnv = variableName(env, "SAFENET_MCP_PRIVATE_KEY_ENV")
  const keystore = env.SAFENET_MCP_KEYSTORE
  const passwordEnv = variableName(env, "SAFENET_MCP_PASSWORD_ENV")
  if (keyEnv && set(keystore)) {
    throw new ConfigError("SAFENET_MCP_PRIVATE_KEY_ENV and SAFENET_MCP_KEYSTORE cannot be used together")
  }
  if (passwordEnv && !set(keystore)) throw new ConfigError("SAFENET_MCP_PASSWORD_ENV only works with SAFENET_MCP_KEYSTORE")
  if (keyEnv) return { kind: "private-key-env", name: keyEnv }
  if (set(keystore)) {
    // The server talks over stdin, so it cannot ask for a password.
    if (!passwordEnv) throw new ConfigError("SAFENET_MCP_KEYSTORE needs SAFENET_MCP_PASSWORD_ENV: the server cannot ask for a password")
    return { kind: "keystore", path: keystore, passwordEnv }
  }
  return null
}

export function readConfig(env: Env): ServerConfig {
  const rpcUrl = set(env.SAFENET_MCP_RPC_URL) ? env.SAFENET_MCP_RPC_URL : undefined
  if (rpcUrl !== undefined && !/^https?:\/\/[^\s]+$/.test(rpcUrl)) {
    throw new ConfigError("SAFENET_MCP_RPC_URL must be an http or https URL")
  }
  const allow = env.SAFENET_MCP_ALLOW_WRITES
  if (set(allow) && allow !== "1" && allow !== "0") {
    throw new ConfigError("SAFENET_MCP_ALLOW_WRITES takes 1 to allow writes, or 0 or nothing to keep every write a dry run")
  }
  const signer = signerRequest(env)
  const notices: string[] = []
  let writes: Writes
  if (allow === "1" && signer) {
    if (signer.kind === "private-key-env" && !set(env[signer.name])) {
      throw new ConfigError("The environment variable named by SAFENET_MCP_PRIVATE_KEY_ENV is not set")
    }
    if (signer.kind === "keystore") {
      if (!existsSync(signer.path)) throw new ConfigError(`The keystore file ${signer.path} does not exist`)
      if (env[signer.passwordEnv] === undefined) {
        throw new ConfigError("The environment variable named by SAFENET_MCP_PASSWORD_ENV is not set")
      }
    }
    writes = { allowed: true, signer }
  } else if (allow === "1") {
    writes = { allowed: false, reason: "SAFENET_MCP_ALLOW_WRITES=1 is set, but no signer is: set SAFENET_MCP_PRIVATE_KEY_ENV, or SAFENET_MCP_KEYSTORE and SAFENET_MCP_PASSWORD_ENV" }
    notices.push(`writes are off: ${writes.reason}`)
  } else {
    writes = { allowed: false, reason: "the server was started without SAFENET_MCP_ALLOW_WRITES=1 and a signer" }
    // The signer is never loaded, so a key is not read for nothing.
    if (signer) notices.push("a signer is set, but SAFENET_MCP_ALLOW_WRITES is not 1: it is not loaded, and every write is a dry run")
  }
  return {
    rpcUrl,
    githubToken: set(env.GITHUB_TOKEN) ? env.GITHUB_TOKEN : set(env.GH_TOKEN) ? env.GH_TOKEN : undefined,
    writes,
    notices,
  }
}
