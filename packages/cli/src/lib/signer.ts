/**
 * Who sends a transaction.
 *
 * The library never holds a key. It hands a finished transaction to a `Signer`, and a dry run
 * has no signer at all: it only knows the address it simulates from. So a dry run cannot sign,
 * whatever else goes wrong.
 */
import {
  BaseError, InsufficientFundsError, keccak256,
  type Address, type Hash, type Hex, type LocalAccount, type PublicClient, type TransactionSerializable,
} from "viem"
import { SafenetError } from "./errors.js"

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
 *
 * The signed bytes fix the hash, so it is known before the broadcast. When the broadcast fails,
 * the node may still have taken the transaction, for example when only its answer was lost. The
 * error then names the hash, because sending again would sign a second transaction with the
 * next nonce and could do the operation twice.
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
      const hash = keccak256(serializedTransaction)
      try {
        return await client.sendRawTransaction({ serializedTransaction })
      } catch (err) {
        // Refused for want of gas money: nothing was sent, and the caller has a sentence for it.
        if (err instanceof BaseError && err.walk((e) => e instanceof InsufficientFundsError)) throw err
        const why = err instanceof BaseError ? err.shortMessage : "no answer"
        throw new SafenetError(
          `The transaction ${hash} was signed, but broadcasting it failed (${why}); it may still reach the ` +
            "network, so look the hash up before sending again",
        )
      }
    },
  }
}
