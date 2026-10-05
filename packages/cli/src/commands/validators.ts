import type { Command } from "commander"
import {
  listValidators, showValidator,
  type Validator, type ValidatorDetail, type ValidatorList,
} from "../lib/index.js"
import type { CommandRuntime } from "../cli.js"
import { formatCount, formatPercent, formatSafe, renderTable, windowSentence } from "./format.js"
import { addressSchema, parseOptions, validatorsListSchema } from "./options.js"

const yesNo = (b: boolean | null) => (b === null ? "not listed" : b ? "yes" : "no")
const rate = (r: number | null) => (r === null ? "not published" : formatPercent(r, 3))

export function renderValidatorList(list: ValidatorList): string {
  const days = list.window.days
  const rows = list.validators.map((v: Validator) => [
    v.label ?? "",
    v.address,
    formatSafe(v.stake),
    formatPercent(v.share),
    rate(v.participation),
    v.commission === null ? "" : formatPercent(v.commission),
    yesNo(v.active),
    yesNo(v.registered),
  ])
  const table = renderTable(
    [
      { header: "LABEL" },
      { header: "ADDRESS" },
      { header: "STAKE", align: "right" },
      { header: "SHARE", align: "right" },
      { header: `PARTICIPATION (${days}d)`, align: "right" },
      { header: "COMMISSION", align: "right" },
      { header: "ACTIVE" },
      { header: "REGISTERED" },
    ],
    rows,
  )
  const n = list.validators.length
  return [
    `Participation: ${windowSentence(list.window)}.`,
    "",
    table,
    "",
    `${n} validator${n === 1 ? "" : "s"}, ${list.filter === "all" ? "all" : "active only"}, ` +
      `sorted by ${list.sort}. Ethereum Mainnet block ${formatCount(list.block)}.`,
    "Sources: stake and share from Staking.totalValidatorStakes() and registered from " +
      "Staking.isValidator(), on chain; label, participation, commission and active from " +
      "SEF's validator-info.json.",
  ].join("\n")
}

export function renderValidatorDetail(d: ValidatorDetail): string {
  const v = d.validator
  const s = d.sources
  const rows: [string, string, string][] = [
    ["Label", v.label ?? "not listed by SEF", s.label],
    ["Address", v.address, ""],
    ["Active", yesNo(v.active), s.active],
    ["Registered", yesNo(v.registered), s.registered],
    ["Stake", formatSafe(v.stake), s.stake],
    ["Share of all stake", formatPercent(v.share), s.share],
    [`Participation (${d.window.days}d)`, rate(v.participation), s.participation],
    ["Commission", v.commission === null ? "not listed by SEF" : formatPercent(v.commission), s.commission],
    [
      "Delegators",
      d.delegators.value
        ? `${formatCount(d.delegators.value.current)} current, ${formatCount(d.delegators.value.ever)} ever`
        : "unavailable, see below",
      d.delegators.source,
    ],
  ]
  return [
    `Validator on Ethereum Mainnet, block ${formatCount(d.block)}`,
    "",
    renderTable([{ header: "FIELD" }, { header: "VALUE" }, { header: "SOURCE" }], rows),
    "",
    `Participation: ${windowSentence(d.window)}.`,
    ...(d.delegators.unavailableBecause ? [`Delegators: ${d.delegators.unavailableBecause}.`] : []),
  ].join("\n")
}

export function registerValidators(program: Command, rt: CommandRuntime): void {
  const validators = program.command("validators").description("the validators and their stake and participation")

  validators
    .command("list")
    .description("every validator SEF lists, with stake from the chain")
    .option("--active", "only validators SEF marks active (the default)")
    .option("--all", "include validators SEF marks inactive")
    .option("--sort <key>", 'sort by "stake" or "participation", highest first (default: stake)')
    .action(async (options: unknown, command: Command) => {
      const globals = rt.globals(command)
      const opts = parseOptions(validatorsListSchema, options)
      rt.emit(globals, await listValidators(rt.context(globals), opts), renderValidatorList)
    })

  validators
    .command("show")
    .description("one validator, with its delegators count")
    .argument("<address>", "the validator's address")
    .action(async (address: string, _options: unknown, command: Command) => {
      const globals = rt.globals(command)
      const addr = parseOptions(addressSchema, address)
      rt.emit(globals, await showValidator(rt.context(globals), addr), renderValidatorDetail)
    })
}
