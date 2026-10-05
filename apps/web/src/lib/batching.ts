/**
 * Whether a wallet's EIP-5792 capabilities for one chain promise an atomic batch.
 *
 * Two shapes are in use. EIP-5792 as finalised, which viem 2 speaks, reports
 * `atomic: { status }`. Wallets built on the earlier draft, Safe among them when this was
 * written, report `atomicBatch: { supported: true }`. Either counts.
 *
 * `atomic.status === "ready"` does not count. It means the wallet can upgrade an EOA to a
 * smart account (EIP-7702) and would ask the user to do so first. That is a decision about
 * their account, not a step in staking, so those wallets get the sequential flow.
 */
export function supportsAtomicBatch(chainCapabilities: unknown): boolean {
  if (typeof chainCapabilities !== "object" || chainCapabilities === null) return false
  const caps = chainCapabilities as {
    atomic?: { status?: unknown }
    atomicBatch?: { supported?: unknown }
  }
  return caps.atomic?.status === "supported" || caps.atomicBatch?.supported === true
}
