/**
 * Decrypting an Ethereum keystore file, version 3 of the Web3 Secret Storage format that geth,
 * Foundry's `cast wallet` and most wallets export.
 *
 * Only Node's own crypto and viem's keccak are used. The key is derived with scrypt or PBKDF2,
 * the MAC is checked before anything is decrypted, and the result is the private key, which the
 * caller turns into an account and never prints.
 */
import { createDecipheriv, pbkdf2Sync, scryptSync } from "node:crypto"
import { bytesToHex, concat, hexToBytes, keccak256, type Hex } from "viem"
import { SafenetError } from "./errors.js"

interface KeystoreV3 {
  version: 3
  crypto: {
    cipher: "aes-128-ctr"
    cipherparams: { iv: string }
    ciphertext: string
    kdf: "scrypt" | "pbkdf2"
    kdfparams: Record<string, unknown>
    mac: string
  }
}

const hex = (s: unknown): s is string => typeof s === "string" && /^(0x)?[0-9a-fA-F]*$/.test(s) && s.length > 0
const bytes = (s: string) => hexToBytes((s.startsWith("0x") ? s : `0x${s}`) as Hex)
const int = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) throw new SafenetError("The keystore file has an invalid key derivation parameter")
  return v
}

function parse(json: unknown): KeystoreV3 {
  const o = json as { version?: unknown; crypto?: unknown; Crypto?: unknown }
  const c = (o?.crypto ?? o?.Crypto) as Partial<KeystoreV3["crypto"]> | undefined
  if (o?.version !== 3 || !c) throw new SafenetError("The keystore file is not a version 3 Ethereum keystore")
  if (c.cipher !== "aes-128-ctr") throw new SafenetError(`The keystore file uses the cipher ${String(c.cipher)}, and only aes-128-ctr is supported`)
  if (c.kdf !== "scrypt" && c.kdf !== "pbkdf2") throw new SafenetError(`The keystore file uses the key derivation ${String(c.kdf)}, and only scrypt and pbkdf2 are supported`)
  if (!hex(c.cipherparams?.iv) || !hex(c.ciphertext) || !hex(c.mac) || typeof c.kdfparams !== "object" || c.kdfparams === null) {
    throw new SafenetError("The keystore file is missing a field a version 3 keystore has")
  }
  return { version: 3, crypto: c as KeystoreV3["crypto"] }
}

function deriveKey(c: KeystoreV3["crypto"], password: string): Uint8Array {
  const p = c.kdfparams
  if (!hex(p.salt)) throw new SafenetError("The keystore file has no salt")
  const salt = bytes(p.salt)
  const dklen = int(p.dklen)
  if (dklen < 32) throw new SafenetError("The keystore file derives a key shorter than 32 bytes")
  if (c.kdf === "scrypt") {
    const N = int(p.n)
    const r = int(p.r)
    const pp = int(p.p)
    return scryptSync(password.normalize("NFKC"), salt, dklen, { N, r, p: pp, maxmem: 256 * N * r * pp })
  }
  if (p.prf !== "hmac-sha256") throw new SafenetError(`The keystore file uses the PBKDF2 function ${String(p.prf)}, and only hmac-sha256 is supported`)
  return pbkdf2Sync(password.normalize("NFKC"), salt, int(p.c), dklen, "sha256")
}

/** The private key in a keystore file. A wrong password fails on the MAC, before decryption. */
export function decryptKeystore(json: unknown, password: string): Hex {
  const c = parse(json).crypto
  const derived = deriveKey(c, password)
  const ciphertext = bytes(c.ciphertext)
  const mac = keccak256(concat([derived.slice(16, 32), ciphertext]))
  if (mac.slice(2).toLowerCase() !== c.mac.replace(/^0x/, "").toLowerCase()) {
    throw new SafenetError("The keystore password is wrong: the file's MAC does not match")
  }
  const decipher = createDecipheriv("aes-128-ctr", derived.slice(0, 16), bytes(c.cipherparams.iv))
  const key = new Uint8Array(Buffer.concat([decipher.update(ciphertext), decipher.final()]))
  if (key.length !== 32) throw new SafenetError("The keystore file does not hold a 32-byte private key")
  return bytesToHex(key)
}
