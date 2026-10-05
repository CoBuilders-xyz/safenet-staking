/**
 * Who sends a transaction.
 *
 * The library never holds a key. It hands a finished transaction to a `Signer`, and a dry run
 * has no signer at all: it only knows the address it simulates from. So a dry run cannot sign,
 * whatever else goes wrong.
 */
import type { Address, Hash, Hex, LocalAccount, PublicClient, TransactionSerializable } from "viem"

/** One transaction, as the library has simulated and estimated it. */
export interface TransactionToSend {
  readonly to: Address
  readonly data: Hex
  readonly gas: bigint
}

export interface Signer {
  readonly address: Address
  /** Signs and broadcasts one transaction, and returns its hash. */
  send(tx: TransactionToSend): Promise<Hash>
}

/**
 * A signer for an account whose key is in this process: a private key or a decrypted keystore.
 * The node fills the nonce and the fees, the account signs, and the signed bytes are broadcast.
 */
export function localSigner(client: PublicClient, account: LocalAccount): Signer {
  return {
    address: account.address,
    async send(tx) {
      const request = await client.prepareTransactionRequest({
        account,
        chain: client.chain,
        to: tx.to,
        data: tx.data,
        gas: tx.gas,
      })
      const serializedTransaction = await account.signTransaction(request as TransactionSerializable)
      return client.sendRawTransaction({ serializedTransaction })
    },
  }
}
