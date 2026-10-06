/**
 * Gnosis consensus figures from one run of `scripts/metrics-poc.ts`, kept as a dated snapshot.
 *
 * The interface shows these when the Gnosis subgraph is not configured, not reachable, or not
 * current. They are a measurement, not a live value, so a screen that shows them must show
 * `runAt` with them.
 *
 * It lives here and not in the web app because it carries validator addresses, and this package
 * is the only place an address is written. Copied unchanged from the run's JSON output.
 *
 * Participation is over the 14 days before `gnosisBlock`. `rate` is our computation and `sef`
 * is SEF's published participation_rate_14d at the same instant: they agree to the last bit.
 */
export interface GnosisSnapshot {
  readonly source: string
  /** ISO 8601. When the run finished. */
  readonly runAt: string
  /** The Gnosis head the run measured to, as a decimal string. */
  readonly gnosisBlock: string
  readonly windowDays: number
  /** Mean TransactionAttested events per complete UTC day in the window. */
  readonly attestationsPerDay: number
  /** Lowest and highest complete day in the window. */
  readonly attestationsPerDayRange: readonly [number, number]
  /** Median blocks from TransactionProposed to TransactionAttested. */
  readonly latencyMedianBlocks: number
  /** The median in seconds, at the block time the run measured. */
  readonly latencySeconds: number
  readonly ceremonies: { readonly all: number; readonly attestations: number }
  readonly participation: readonly {
    readonly label: string
    readonly address: `0x${string}`
    readonly rate: number
    readonly sef: number
    readonly absences: number
  }[]
}

export const GNOSIS_SNAPSHOT: GnosisSnapshot = {
  source: "packages/core/scripts/metrics-poc.ts",
  runAt: "2026-09-29T14:41:20.185Z",
  gnosisBlock: "48500766",
  windowDays: 14,
  attestationsPerDay: 4510,
  attestationsPerDayRange: [3093, 5908],
  latencyMedianBlocks: 5,
  latencySeconds: 25,
  ceremonies: { all: 64427, attestations: 64263 },
  participation: [
    { label: "RockawayX", address: "0xb0E735D4a3b70195420E0ae933689A55750CFcd2", rate: 1, sef: 1, absences: 0 },
    { label: "Core Contributors", address: "0xCc00DE0eA14c08669b26DcBFE365dBD9890B04D9", rate: 0.9993153136330393, sef: 0.9993153136330393, absences: 44 },
    { label: "Safe Labs", address: "0xF6EA21D702983c443f58A267265912FE03D2FF0b", rate: 0.9974479871776917, sef: 0.9974479871776917, absences: 164 },
    { label: "Greenfield", address: "0x7B0A8EFA45dE81F11F2846EC28259B62155a2b37", rate: 0.9917526414888816, sef: 0.9917526414888816, absences: 530 },
    { label: "Blockchain Capital", address: "0xD8997c2a94052C4FB79B53b3e255c1F07c99305B", rate: 0.9905233182391111, sef: 0.9905233182391111, absences: 609 },
    { label: "Gnosis", address: "0x3D58a5475c1336b0A755c3aBd298CeB9b7BB9CDe", rate: 0.9593856495961907, sef: 0.9593856495961907, absences: 2610 },
  ],
}
