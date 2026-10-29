import { CONTRACTS, GNOSIS_AEGIS_FIRST_COMPLETE_DAY, utcDayMs } from "@cobuilders/safenet-core"

export interface RoundEvent {
  kind: "member" | "share" | "completed" | "attested"
  block: string
  index: number
  time: number
  sid?: string
  root?: string
  participant?: string
  staker?: string
}
interface Ceremony {
  shares: Record<string, string[]>
  root?: string
  at?: { block: string; index: number; time: number; members: string[] }
}
export interface Chronology {
  cursor: string
  hash: string | null
  members: Record<string, { staker: string | null; misses: number; streakStart: string | null }>
  pending: Record<string, Ceremony>
  counted: Record<string, string>
  rounds: { sid: string; time: number; present: string[] }[]
}
export const initialChronology = (): Chronology => ({ cursor: (CONTRACTS.aegisFrostCoordinator.deployBlock - 1n).toString(), hash: null, members: {}, pending: {}, counted: {}, rounds: [] })
const position = (a: { block: string; index: number }, b: { block: string; index: number }) =>
  BigInt(a.block) < BigInt(b.block) ? -1 : BigInt(a.block) > BigInt(b.block) ? 1 : a.index - b.index

/** Fold a contiguous, finalized range, never totals. Only attested winning-root ceremonies count.
 * Membership begins at the first Aegis event, matching the subgraph's programme membership.
 * A missing completion blocks subsequent rounds; unknown history never becomes a miss.
 */
export function foldChronology(previous: Chronology, events: RoundEvent[], through: bigint, hash: string, now: number): Chronology {
  const state = structuredClone(previous)
  for (const event of [...events].sort(position)) {
    if (BigInt(event.block) <= BigInt(previous.cursor) || BigInt(event.block) > through) throw new Error("Noncontiguous event range")
    if (event.participant) {
      const who = event.participant.toLowerCase()
      state.members[who] ??= { staker: null, misses: 0, streakStart: null }
      if (event.staker) state.members[who]!.staker = event.staker.toLowerCase()
    }
    if (!event.sid || state.counted[event.sid]) continue
    const ceremony = state.pending[event.sid] ??= { shares: {} }
    if (event.kind === "share" && !ceremony.root) {
      const participants = ceremony.shares[event.root!] ??= []
      if (!participants.includes(event.participant!.toLowerCase())) participants.push(event.participant!.toLowerCase())
    }
    if (event.kind === "completed") ceremony.root ??= event.root!
    if (event.kind === "attested") ceremony.at ??= { block: event.block, index: event.index, time: event.time, members: Object.keys(state.members) }
  }
  const ordered = Object.entries(state.pending).filter(([, c]) => c.at).sort(([, a], [, b]) => position(a.at!, b.at!))
  for (const [sid, c] of ordered) {
    if (!c.root) break
    const present = c.shares[c.root] ?? []
    for (const who of c.at!.members) {
      const member = state.members[who]!
      if (present.includes(who)) { member.misses = 0; member.streakStart = null }
      else { member.misses++; member.streakStart ??= sid }
    }
    state.rounds.push({ sid, time: c.at!.time, present })
    state.counted[sid] = through.toString()
    delete state.pending[sid]
  }
  // Without a verified maximum attestation delay, pruning unmatched shares can invent misses.
  // Bound memory and fail visibly at capacity, including for long-lived unattested ceremonies.
  if (Object.keys(state.pending).length > 10_000) throw new Error("Unresolved ceremony capacity reached")
  for (const [sid, block] of Object.entries(state.counted)) if (BigInt(block) + 1000n < through) delete state.counted[sid]
  state.rounds = state.rounds.filter(r => r.time >= now - 16 * 86400)
  state.cursor = through.toString()
  state.hash = hash
  return state
}

export function memberCondition(state: Chronology, staker: string, now: number) {
  if (Object.values(state.pending).some(c => c.at)) throw new Error("Attestation chronology incomplete")
  const today = Math.floor(now / 86400) * 86400
  const complete = state.rounds.filter(r => r.time < today)
  const last = complete.length ? Math.floor(Math.max(...complete.map(r => r.time)) / 86400) * 86400 : null
  const first = last === null ? null : Math.max(last - 13 * 86400, utcDayMs(GNOSIS_AEGIS_FIRST_COMPLETE_DAY) / 1000)
  const window = first === null ? [] : complete.filter(r => r.time >= first)
  const members = Object.entries(state.members).filter(([, m]) => m.staker === staker.toLowerCase())
  return members.map(([signer, member]) => ({
    signer, misses: member.misses, streakStart: member.streakStart,
    participation: window.length ? window.filter(r => r.present.includes(signer)).length * 100 / window.length : null,
  }))
}
