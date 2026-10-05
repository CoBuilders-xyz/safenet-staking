/**
 * What every write command shares: its options, how it reports a transaction while it runs, and
 * how it prints the transactions it sent or would send.
 */
import { maxUint256 } from "viem"
import type { Command } from "commander"
import type { Approval, Figure, Progress, Step, WriteResultBase } from "../lib/index.js"
import { formatCount, formatSafe, renderTable } from "./format.js"

export function addWriteOptions(command: Command): Command {
  return command
    .option("--dry-run", "read, simulate and estimate every transaction, and print what would be sent; nothing is signed")
    .option("--private-key-env <NAME>", "sign with the private key held in the environment variable NAME")
    .option("--keystore <path>", "sign with a version 3 keystore file; asks for its password")
    .option("--password-env <NAME>", "with --keystore: read the password from the environment variable NAME")
    .option("--from <address>", "with --dry-run and no signer option: the address to simulate from")
}

/** The two lines every write starts with: what it does, and whether anything was sent. */
export function writeHead(r: WriteResultBase, title: string): string[] {
  return [
    `${title}, from ${r.from}`,
    r.dryRun
      ? `Dry run against Ethereum Mainnet block ${formatCount(r.block)}: simulated and estimated, nothing signed or sent.`
      : `Sent on Ethereum Mainnet. The figures before it were read at block ${formatCount(r.block)}.`,
  ]
}

export type FigureRow = readonly [string, string, string]

export function figureRow<T>(label: string, f: Figure<T>, value: (v: T) => string): FigureRow {
  return [label, value(f.value), f.source]
}

export function renderFigures(rows: readonly FigureRow[]): string {
  return renderTable([{ header: "FIGURE" }, { header: "VALUE" }, { header: "SOURCE" }], rows)
}

export function approvalText(approval: Approval | null): string {
  if (!approval) return "not needed: the allowance covers the amount"
  return approval.kind === "unlimited" ? "unlimited" : `exact, ${formatSafe(approval.amount.wei)}`
}

function argValue(name: string, value: unknown): string[] {
  if (typeof value === "bigint") {
    if (value === maxUint256) return [`${value} (2^256 - 1, unlimited)`]
    return [/amount/i.test(name) ? `${value} (${formatSafe(value)})` : String(value)]
  }
  if (Array.isArray(value)) return value.length === 0 ? ["[] (empty)"] : value.map(String)
  return [String(value)]
}

/** Each transaction: its contract and function, every argument, the gas and its source, and the receipt. */
export function renderSteps(steps: readonly Step[]): string {
  if (steps.length === 0) return "Transactions: none."
  const blocks = steps.map((s, i) => {
    const pairs: [string, string][] = [["to", s.to]]
    for (const [name, value] of Object.entries(s.args)) {
      const [first = "", ...rest] = argValue(name, value)
      pairs.push([name, first], ...rest.map((v): [string, string] => ["", v]))
    }
    pairs.push(["gas", `${formatCount(s.gas.value)} (${s.gas.source})`])
    const t = s.transaction
    pairs.push([
      "sent",
      t ? `${t.hash}, block ${formatCount(t.block)}, status ${t.status}, gas used ${formatCount(t.gasUsed)}` : "no, dry run",
    ])
    const width = Math.max(...pairs.map(([k]) => k.length))
    return [
      `  ${i + 1}. ${s.contract}.${s.function}`,
      ...pairs.map(([k, v]) => `       ${k.padEnd(width)}  ${v}`.trimEnd()),
    ].join("\n")
  })
  return [`Transactions (${steps.length}):`, ...blocks].join("\n")
}

/** One line per event of a live run, on stderr, so a hash is on screen the moment it exists. */
export function renderProgress(event: Progress): string {
  switch (event.type) {
    case "sent":
      return `sent ${event.contract}.${event.functionName}: ${event.hash}, waiting for its receipt`
    case "confirmed": {
      const t = event.step.transaction!
      return `confirmed ${event.step.contract}.${event.step.function.split("(")[0]}: ${t.hash}, block ` +
        `${formatCount(t.block)}, status ${t.status}, gas used ${formatCount(t.gasUsed)}`
    }
    case "received":
      return `received ${formatSafe(event.amount.wei)} (${event.amount.wei} wei), from ${event.source}`
    case "capped":
      return `staking ${formatSafe(event.received.wei)} instead of the requested ${formatSafe(event.requested.wei)}: ` +
        "the claim paid less than the proof's claimable amount"
  }
}
