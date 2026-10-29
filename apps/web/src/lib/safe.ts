/** Whether the app is running inside a Safe Wallet iframe. */
export const isSafeApp =
  typeof window !== "undefined" && window.self !== window.top

/**
 * How long the Safe connector waits for Safe{Wallet} to answer its first request, `getSafeInfo`,
 * before it gives up on the connection. wagmi's default is 10 ms. Measured against Safe{Wallet}
 * on 2026-10-27, an answer takes a few milliseconds when idle, but tens to hundreds while either
 * page loads, and up to 1,060 ms with Safe{Wallet} slowed four times, where the default failed
 * one load in four. A failed connection is silent, and a Safe App shows no Connect control, so
 * the user is left without a wallet. Two seconds is about twice the slowest answer measured. The
 * wait applies only inside an iframe: outside one, the connector returns before it asks.
 */
export const SAFE_INFO_TIMEOUT_MS = 2_000
