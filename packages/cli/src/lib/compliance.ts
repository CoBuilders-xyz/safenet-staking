/**
 * The compliance gates every write passes before anything is signed, dry runs included: the
 * gates of the web interface, in core's `src/compliance.ts`.
 *
 * - The sanctions oracle on chain is always read, for the address that would sign or that a dry
 *   run simulates from. Only an explicit false allows it.
 * - `sanctionsEndpoint`, when given: a GET to that URL, which judges the client making the
 *   request. 403 refuses, as does any other failure.
 * - `geoCheck`, when true: the country of this machine's IP from core's lookups, against core's
 *   blocked countries. No country refuses.
 *
 * Each gate fails closed. The report names every gate, run or not, and is part of each write's
 * result. A refusal throws ComplianceRefusal with the report, before the write reads anything else.
 * No message carries the endpoint's URL, which may hold a key.
 */
import type { Address } from "viem"
import {
  CONTRACTS, isCountryCode, GEO_LOOKUPS, GEOBLOCKED_COUNTRIES, SANCTIONS_ENDPOINT_REFUSED_STATUS, sanctionsOracleAbi, type GeoLookup,
} from "@cobuilders/safenet-core"
import type { Context } from "./context.js"
import { SafenetError } from "./errors.js"
import { redactUrls } from "./redact.js"

export interface ComplianceOptions {
  /** A URL to GET before signing. Its 403 refuses. */
  readonly sanctionsEndpoint?: string | null | undefined
  /** Refuse when this machine's IP is in a blocked country. */
  readonly geoCheck?: boolean | undefined
}

export type GateName = "sanctions oracle" | "sanctions endpoint" | "geo check"

export interface GateResult {
  readonly gate: GateName
  /** False when the gate was not asked for. */
  readonly checked: boolean
  /** True when the gate let the write through, or was not asked for. */
  readonly allowed: boolean
  /** What the gate found, as the end of a sentence. */
  readonly reason: string
  readonly source: string
}

export interface ComplianceReport {
  readonly address: Address
  /** The block the oracle was read at, or null when the head could not be read. */
  readonly block: bigint | null
  readonly allowed: boolean
  readonly gates: readonly GateResult[]
}

/** A gate refused. Nothing was signed or sent, and the report says which gate and why. */
export class ComplianceRefusal extends SafenetError {
  constructor(readonly report: ComplianceReport) {
    const refused = report.gates.filter((g) => !g.allowed)
    super(
      `A compliance gate refused ${report.address}, so nothing was signed or sent: ` +
        refused.map((g) => `${g.gate}: ${g.reason}`).join("; "),
    )
  }
}

const ORACLE_SOURCE = "chain: SanctionsList.isSanctioned(address)"
const ENDPOINT_SOURCE = "the operator's sanctions endpoint, GET"
/** Every gate result in the same field order, so the JSON reads the same for each. */
const result = (gate: GateName, checked: boolean, allowed: boolean, reason: string, source: string): GateResult =>
  ({ gate, checked, allowed, reason, source })

/** Ten seconds for each request: a gate that hangs refuses rather than waits. */
const TIMEOUT_MS = 10_000

async function oracleGate(ctx: Context, address: Address, block: bigint | null): Promise<GateResult> {
  const oracle = (allowed: boolean, reason: string) => result("sanctions oracle", true, allowed, reason, ORACLE_SOURCE)
  if (block === null) return oracle(false, "the chain head could not be read, so the gate fails closed")
  try {
    const sanctioned = await ctx.client.readContract({
      address: CONTRACTS.sanctionsList.address,
      abi: sanctionsOracleAbi,
      functionName: "isSanctioned",
      args: [address],
      blockNumber: block,
    })
    if (sanctioned === false) return oracle(true, "the address is not on the sanctions list")
    if (sanctioned === true) return oracle(false, "the address is on the sanctions list")
    return oracle(false, "the oracle gave no clear answer, so the gate fails closed")
  } catch (err) {
    return oracle(false, `the oracle could not be read (${redactUrls(errorText(err))}), so the gate fails closed`)
  }
}

async function endpointGate(ctx: Context, url: string | null | undefined): Promise<GateResult> {
  const endpoint = (allowed: boolean, reason: string) => result("sanctions endpoint", true, allowed, reason, ENDPOINT_SOURCE)
  if (!url) return result("sanctions endpoint", false, true, "not asked for", "none")
  try {
    const response = await ctx.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    await response.body?.cancel()
    if (response.status === SANCTIONS_ENDPOINT_REFUSED_STATUS) {
      return endpoint(false, `the endpoint refused this client (HTTP ${response.status})`)
    }
    if (!response.ok) {
      return endpoint(false, `the endpoint answered HTTP ${response.status}, so the gate fails closed`)
    }
    return endpoint(true, `the endpoint allowed this client (HTTP ${response.status})`)
  } catch {
    return endpoint(false, "the endpoint did not answer, so the gate fails closed")
  }
}

async function lookUpCountry(ctx: Context, lookup: GeoLookup): Promise<string> {
  const response = await ctx.fetch(lookup.url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`HTTP ${response.status}`)
  }
  const country = lookup.format === "json"
    ? ((await response.json()) as { country?: unknown }).country
    : (await response.text()).trim()
  if (!isCountryCode(country)) throw new Error("no recognized country code")
  return country
}

async function geoGate(ctx: Context, asked: boolean | undefined): Promise<GateResult> {
  if (!asked) return result("geo check", false, true, "not asked for", "none")
  const failures: string[] = []
  for (const lookup of GEO_LOOKUPS) {
    try {
      const country = await lookUpCountry(ctx, lookup)
      const source = `${lookup.name}, the country of this machine's IP address`
      return GEOBLOCKED_COUNTRIES.includes(country)
        ? result("geo check", true, false, `this machine appears to be in ${country}, a blocked country`, source)
        : result("geo check", true, true, `this machine appears to be in ${country}`, source)
    } catch (err) {
      failures.push(`${lookup.name}: ${redactUrls(errorText(err))}`)
    }
  }
  return result("geo check", true, false, `no lookup named a country (${failures.join("; ")}), so the gate fails closed`,
    GEO_LOOKUPS.map((l) => l.name).join(", then "))
}

function errorText(err: unknown): string {
  return err instanceof Error ? (err.message.split("\n")[0] ?? err.name) : String(err)
}

/** Runs every gate for `address` and returns the report; throws ComplianceRefusal when one refuses. */
export async function checkCompliance(ctx: Context, address: Address, options: ComplianceOptions = {}): Promise<ComplianceReport> {
  const block = await ctx.client.getBlockNumber().catch(() => null)
  const gates = await Promise.all([
    oracleGate(ctx, address, block),
    endpointGate(ctx, options.sanctionsEndpoint),
    geoGate(ctx, options.geoCheck),
  ])
  const report: ComplianceReport = { address, block, allowed: gates.every((g) => g.allowed), gates }
  if (!report.allowed) throw new ComplianceRefusal(report)
  return report
}
