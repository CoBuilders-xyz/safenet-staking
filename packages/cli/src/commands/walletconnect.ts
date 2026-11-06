/** WalletConnect wallets sign and broadcast. The selected RPC polls receipts. Sessions stay in memory. */
import {
  decodeFunctionData, getAddress, maxUint256, numberToHex,
  type Address, type Hash, type TransactionSerializable,
} from "viem"
import { CHAINS, CONTRACTS, erc20Abi, stakingAbi, merkleDropAbi } from "@cobuilders/safenet-core"
import { SafenetError, type Context, type Signer, type TransactionToSend } from "../lib/index.js"

const CHAIN = CHAINS.mainnet.id
const NAMESPACE = `eip155:${CHAIN}`
const TIMEOUT = 120_000

type Session = { topic: string; namespaces: Record<string, { accounts: string[]; methods: string[] }> }

/** A narrow transport boundary. Tests replace this to exercise wallet responses. */
export interface WalletBridge {
  connect(): Promise<{ uri?: string; approval(): Promise<Session> }>
  request(topic: string, transaction: Record<string, string>): Promise<unknown>
  onChange(listener: () => void): () => void
  close(): Promise<void>
}

export interface WalletInteraction {
  readonly showUri: (uri: string, signal: AbortSignal) => Promise<void>
  readonly confirm: (review: string, signal: AbortSignal) => Promise<boolean>
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

/** WalletConnect's entire storage interface, backed by this invocation's memory only. */
export function memoryStorage() {
  const values = new Map<string, unknown>()
  return {
    getKeys: async () => [...values.keys()],
    getEntries: async <T>() => [...values.entries()] as [string, T][],
    getItem: async <T>(key: string) => values.get(key) as T | undefined,
    setItem: async <T>(key: string, value: T) => { values.set(key, value) },
    removeItem: async (key: string) => { values.delete(key) },
    clear: () => values.clear(),
  }
}

export async function createWalletBridge(projectId: string, signal?: AbortSignal): Promise<WalletBridge> {
  const [{ SignClient }, { Core, RELAYER_EVENTS }] = await Promise.all([
    import("@walletconnect/sign-client"), import("@walletconnect/core"),
  ])
  const storage = memoryStorage()
  const core = new Core({ projectId, logger: "silent", storage, telemetryEnabled: false })
  const stop = async () => {
    core.heartbeat.stop()
    try { await core.relayer.transportClose() } finally { storage.clear() }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let abandoned = false
  let cancel = () => {}
  const initialize = SignClient.init({
    // SDK's Core allows relayUrl=undefined; its ICore declaration omits that optional value.
    core: core as NonNullable<NonNullable<Parameters<typeof SignClient.init>[0]>["core"]>, logger: "silent",
    metadata: {
      name: "Safenet CLI", description: "Review and send Safenet transactions",
      url: "https://github.com/CoBuilders-xyz/safenet-staking", icons: [],
    },
  })
  // If initialization finishes after its deadline, it must not leave a live relay behind.
  void initialize.then(async () => { if (abandoned) await stop() }, () => {}).catch(() => {})
  let client: Awaited<typeof initialize>
  try {
    client = await Promise.race([initialize, new Promise<never>((_, reject) => {
      cancel = () => reject(new SafenetError("Wallet initialization cancelled"))
      signal?.addEventListener("abort", cancel, { once: true })
      if (signal?.aborted) cancel()
      timer = setTimeout(() => reject(new SafenetError("Wallet initialization timed out")), TIMEOUT)
    })])
  } catch (err) { abandoned = true; await stop(); throw err }
  finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel) }
  return {
    connect: () => client.connect({ requiredNamespaces: {
      eip155: { chains: [NAMESPACE], methods: ["eth_sendTransaction"], events: ["accountsChanged", "chainChanged"] },
    } }),
    request: (topic, transaction) => client.request({
      topic, chainId: NAMESPACE, request: { method: "eth_sendTransaction", params: [transaction] },
    }),
    onChange(listener) {
      // Any session mutation requires a fresh invocation, including a change back to the original account.
      const events = ["session_event", "session_update", "session_delete", "session_expire"] as const
      for (const event of events) client.on(event, listener)
      client.core.relayer.on(RELAYER_EVENTS.disconnect, listener)
      client.core.relayer.on(RELAYER_EVENTS.transport_closed, listener)
      return () => {
        for (const event of events) client.off(event, listener)
        client.core.relayer.off(RELAYER_EVENTS.disconnect, listener)
        client.core.relayer.off(RELAYER_EVENTS.transport_closed, listener)
      }
    },
    async close() {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          Promise.allSettled(client.session.getAll().map((s) => client.disconnect({
            topic: s.topic, reason: { code: 6000, message: "CLI command finished" },
          }))),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, 1000) }),
        ])
      } finally { clearTimeout(timer); await stop() }
    },
  }
}

function review(tx: TransactionToSend, from: Address, request: TransactionSerializable): string {
  // ABIs and destinations come only from core. Unknown targets fail before a transaction is requested.
  const contracts = [
    { address: CONTRACTS.safeToken.address, abi: erc20Abi, name: "SAFE token" },
    { address: CONTRACTS.staking.address, abi: stakingAbi, name: "Staking" },
    { address: CONTRACTS.merkleDrop.address, abi: merkleDropAbi, name: "MerkleDrop" },
  ]
  const contract = contracts.find((c) => c.address.toLowerCase() === tx.to.toLowerCase())
  if (!contract) throw new SafenetError("The wallet transaction has an unknown contract destination")
  const decoded = decodeFunctionData({ abi: contract.abi, data: tx.data })
  const definition = contract.abi.find((item) => item.type === "function" && item.name === decoded.functionName)
  const args = definition?.type === "function"
    ? Object.fromEntries(definition.inputs.map((input, i) => [input.name || `arg${i}`, decoded.args?.[i]]))
    : decoded.args
  return JSON.stringify({
    chain: CHAIN, from, to: tx.to, contract: contract.name, function: decoded.functionName,
    args, unlimitedApproval: decoded.functionName === "approve" && decoded.args?.[1] === maxUint256,
    value: "0", gas: tx.gas, nonce: request.nonce,
    maxFeePerGas: request.maxFeePerGas, maxPriorityFeePerGas: request.maxPriorityFeePerGas,
    gasPrice: request.gasPrice,
  }, (_, value: unknown) => typeof value === "bigint" ? value.toString() : value, 2)
}

/** Review each wallet request and verify its mined call before the runner can confirm or continue. */
export async function walletConnectSigner(
  ctx: Context, expected: Address, bridge: WalletBridge, interaction: WalletInteraction,
): Promise<Signer> {
  const controller = new AbortController()
  let invalid = false
  let closed = false
  let requestNonceFloor: number | undefined
  const pending = new Set<() => void>()
  const invalidate = () => { invalid = true; controller.abort(); for (const reject of pending) reject() }
  const off = bridge.onChange(invalidate)
  interaction.signal?.addEventListener("abort", invalidate, { once: true })
  const bounded = async <T>(work: () => Promise<T>, label: string): Promise<T> => {
    if (invalid || interaction.signal?.aborted) throw new SafenetError("Wallet connection cancelled, disconnected, or changed; reconnect")
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancel: () => void = () => {}
    try {
      return await new Promise<T>((resolve, reject) => {
        cancel = () => reject(new SafenetError("Wallet connection cancelled, disconnected, or changed; reconnect"))
        pending.add(cancel)
        timer = setTimeout(() => {
          controller.abort()
          invalid = true
          reject(new SafenetError(`Wallet ${label} timed out; reconnect before trying again`))
        }, interaction.timeoutMs ?? TIMEOUT)
        Promise.resolve().then(work).then(resolve, () => reject(new SafenetError(`Wallet ${label} was rejected or failed`)))
      })
    } finally { clearTimeout(timer); pending.delete(cancel) }
  }

  const close = async () => {
    if (closed) return
    closed = true
    invalidate()
    off()
    interaction.signal?.removeEventListener("abort", invalidate)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([bridge.close(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 3000) })])
    } catch {
      // Cleanup must not replace a rejection or leak the transport's diagnostic payload.
    } finally { clearTimeout(timer) }
  }
  try {
    if (await bounded(() => ctx.client.getChainId(), "RPC check") !== CHAIN) {
      throw new SafenetError("The RPC endpoint is not Ethereum Mainnet; nothing was signed")
    }
    const connection = await bounded(() => bridge.connect(), "connection")
    if (!connection.uri) throw new SafenetError("Wallet pairing did not provide a fresh URI")
    await bounded(() => interaction.showUri(connection.uri!, controller.signal), "pairing")
    const session = await bounded(() => connection.approval(), "approval")
    const namespace = session.namespaces.eip155 ?? session.namespaces[NAMESPACE]
    if (!namespace?.methods.includes("eth_sendTransaction") ||
      !namespace.accounts.some((a) => a.toLowerCase() === `${NAMESPACE}:${expected}`.toLowerCase())) {
      throw new SafenetError("Wallet must approve the requested Mainnet account and eth_sendTransaction; this wallet may be unsupported")
    }
    return {
      address: getAddress(expected), close,
      async verifyConfirmedTransaction(tx, receipt) {
        try {
          const mined = await bounded(() => ctx.client.getTransaction({ hash: receipt.transactionHash }), "confirmed transaction lookup")
          if (requestNonceFloor === undefined || !Number.isSafeInteger(mined.nonce) || mined.nonce < requestNonceFloor ||
            mined.hash?.toLowerCase() !== receipt.transactionHash.toLowerCase() ||
            !mined.blockHash || mined.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase() ||
            mined.from?.toLowerCase() !== expected.toLowerCase() || mined.to?.toLowerCase() !== tx.to.toLowerCase() ||
            mined.input?.toLowerCase() !== tx.data.toLowerCase() || mined.value !== 0n) {
            throw new Error("Confirmed transaction does not match the reviewed call")
          }
          requestNonceFloor = undefined
        } catch {
          invalidate()
          throw new SafenetError(`Wallet transaction ${receipt.transactionHash} could not be verified against the reviewed call; ` +
            "the wallet may already have broadcast; no further steps were sent; check wallet activity before retrying")
        }
      },
      async send(tx) {
        if (await bounded(() => ctx.client.getChainId(), "RPC check") !== CHAIN) {
          throw new SafenetError("The RPC chain changed; nothing was signed")
        }
        const prepared = await bounded(() => ctx.client.prepareTransactionRequest({
          account: expected, chain: CHAINS.mainnet, to: tx.to, data: tx.data, gas: tx.gas, value: 0n,
        }), "transaction preparation")
        if (prepared.type !== "legacy" && prepared.type !== "eip1559") {
          throw new SafenetError("The RPC prepared an unsupported transaction type; nothing was signed")
        }
        // eth_fillTransaction can include an effective gasPrice alongside EIP-1559 fee caps.
        // Only the fees for the selected transaction type belong in review and the wallet request.
        const request = {
          ...prepared,
          gasPrice: prepared.type === "legacy" ? prepared.gasPrice : undefined,
          maxFeePerGas: prepared.type === "eip1559" ? prepared.maxFeePerGas : undefined,
          maxPriorityFeePerGas: prepared.type === "eip1559" ? prepared.maxPriorityFeePerGas : undefined,
        }
        if (!await bounded(() => interaction.confirm(review(tx, expected, request as TransactionSerializable), controller.signal), "review")) {
          throw new SafenetError("Cancelled at transaction review; nothing was signed")
        }
        if (await bounded(() => ctx.client.getChainId(), "RPC check") !== CHAIN) {
          throw new SafenetError("The RPC chain changed during review; nothing was signed")
        }
        const wire: Record<string, string> = {
          from: expected, to: tx.to, data: tx.data, value: "0x0", chainId: numberToHex(CHAIN),
          type: numberToHex(prepared.type === "eip1559" ? 2 : 0),
        }
        for (const key of ["gas", "nonce", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas"] as const) {
          const value = request[key]
          if (value != null) wire[key] = numberToHex(value)
        }
        // Reject hashes for already-mined account nonces, including earlier calls in the same block.
        // This is a lower bound, not a requirement to use the prepared nonce; replacements remain valid.
        const nonceFloor = await bounded(() => ctx.client.getTransactionCount({
          address: expected, blockTag: "latest",
        }), "request nonce check")
        if (!Number.isSafeInteger(nonceFloor) || nonceFloor < 0) {
          throw new SafenetError("The RPC returned an invalid account nonce; nothing was sent to the wallet")
        }
        requestNonceFloor = nonceFloor
        let hash: unknown
        try {
          // The wallet owns broadcast. A timeout or disconnect cannot revoke its pending request.
          hash = await bounded(() => bridge.request(session.topic, wire), "transaction request")
        } catch (err) {
          invalidate()
          const message = err instanceof SafenetError ? err.message : "Wallet transaction request failed"
          throw new SafenetError(`${message}; the wallet may have broadcast; check wallet activity before retrying`)
        }
        if (typeof hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(hash)) {
          invalidate()
          throw new SafenetError("Wallet returned an invalid transaction hash; it may have broadcast; check wallet activity before retrying")
        }
        return hash as Hash
      },
    }
  } catch (err) { await close(); throw err }
}
