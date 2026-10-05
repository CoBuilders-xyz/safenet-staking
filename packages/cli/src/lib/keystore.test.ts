import { test } from "node:test"
import assert from "node:assert/strict"
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { bytesToHex, concat, keccak256 } from "viem"
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts"
import { decryptKeystore } from "./keystore.js"
import { TEST_MNEMONIC } from "../test-support.js"

// The scrypt fixture was written by Foundry's `cast wallet import`, an implementation other than
// this one, for account 1 of the public test mnemonic, with its address field removed.
const fixture = JSON.parse(readFileSync(new URL("../fixtures/keystore-anvil-1.json", import.meta.url), "utf8")) as unknown

test("a keystore written by Foundry decrypts to the key of its account", () => {
  const key = decryptKeystore(fixture, "safenet fixture")
  assert.equal(privateKeyToAccount(key).address, mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 }).address)
})

test("a wrong password fails on the MAC", () => {
  assert.throws(() => decryptKeystore(fixture, "safenet fixturE"), /password is wrong/)
})

test("a PBKDF2 keystore decrypts too", () => {
  // Built here by the steps the format defines, as no fixture tool at hand writes PBKDF2.
  const key = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 2 }).getHdKey().privateKey!
  const salt = randomBytes(32)
  const iv = randomBytes(16)
  const derived = pbkdf2Sync("pw", salt, 1024, 32, "sha256")
  const cipher = createCipheriv("aes-128-ctr", derived.subarray(0, 16), iv)
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()])
  const keystore = {
    version: 3,
    crypto: {
      cipher: "aes-128-ctr",
      cipherparams: { iv: iv.toString("hex") },
      ciphertext: ciphertext.toString("hex"),
      kdf: "pbkdf2",
      kdfparams: { c: 1024, dklen: 32, prf: "hmac-sha256", salt: salt.toString("hex") },
      mac: keccak256(concat([derived.subarray(16, 32), ciphertext])).slice(2),
    },
  }
  assert.equal(decryptKeystore(keystore, "pw"), bytesToHex(key))
})

test("a file that is not a version 3 keystore is refused in one sentence", () => {
  assert.throws(() => decryptKeystore({ version: 1 }, "pw"), /not a version 3 Ethereum keystore/)
  assert.throws(() => decryptKeystore({ version: 3, crypto: { cipher: "aes-256-gcm" } }, "pw"), /only aes-128-ctr/)
})
