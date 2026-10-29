import { test } from "node:test"
import assert from "node:assert/strict"
import { buildProgram, type Runtime } from "@cobuilders/safenet-cli/program"
import { inputJsonSchema, TOOLS } from "./tools.js"

type Command = ReturnType<typeof buildProgram>

// The tools against the CLI's own command definitions: one tool per command, the same names,
// the same arguments and options, required where the CLI requires them, flags as booleans and
// values as strings. A command added to the CLI without a tool, or an option renamed on one
// side only, fails here.

/** Options that configure the signer. The server takes them at start, never in a tool call. */
const SIGNER_OPTIONS = ["privateKeyEnv", "keystore", "passwordEnv", "walletconnect", "walletAccount"]

const unused = () => {
  throw new Error("the parity test only reads the command definitions")
}
const runtime: Runtime = {
  io: { out: () => {}, err: () => {} },
  env: {},
  createContext: unused,
  loadSigner: unused,
}

function leaves(command: Command, path: string[] = []): { path: string[]; command: Command }[] {
  if (command.commands.length === 0) return [{ path, command }]
  return command.commands.flatMap((c) => leaves(c, [...path, c.name()]))
}

interface Shape {
  readonly type: "boolean" | "string"
  readonly required: boolean
}

/** What the CLI takes: arguments by name, options by attribute name, without the signer ones. */
function cliShape(command: Command): Record<string, Shape> {
  const shape: Record<string, Shape> = {}
  for (const a of command.registeredArguments) shape[a.name()] = { type: "string", required: a.required }
  for (const o of command.options) {
    if (SIGNER_OPTIONS.includes(o.attributeName())) continue
    shape[o.attributeName()] = { type: o.isBoolean() ? "boolean" : "string", required: false }
  }
  return shape
}

/** What the tool takes, from the JSON Schema a client sees. */
function toolShape(name: string): Record<string, Shape> {
  const tool = TOOLS.find((t) => t.name === name)!
  const schema = inputJsonSchema(tool) as { properties?: Record<string, { type?: string }>; required?: string[] }
  const shape: Record<string, Shape> = {}
  for (const [key, property] of Object.entries(schema.properties ?? {})) {
    assert.ok(property.type === "boolean" || property.type === "string", `${name}.${key} has type ${property.type}`)
    shape[key] = { type: property.type, required: (schema.required ?? []).includes(key) }
  }
  return shape
}

const commands = leaves(buildProgram(runtime))

test("every CLI command has a tool, and every tool a CLI command", () => {
  const toolName = (path: string[]) => path.join("_").replace(/-/g, "_")
  assert.deepEqual(
    commands.map((c) => toolName(c.path)).sort(),
    TOOLS.map((t) => t.name).sort(),
  )
  for (const { path } of commands) {
    const tool = TOOLS.find((t) => t.name === toolName(path))!
    assert.deepEqual(tool.command, path, `${tool.name} names the command ${tool.command.join(" ")}`)
  }
  assert.equal(TOOLS.length, 11)
})

test("each tool takes the arguments and options of its command, with the same shapes", () => {
  for (const { path, command } of commands) {
    const tool = TOOLS.find((t) => t.command.join(" ") === path.join(" "))!
    assert.deepEqual(toolShape(tool.name), cliShape(command), `safenet ${path.join(" ")} and the ${tool.name} tool differ`)
  }
})

test("the write tools are the commands with --dry-run and the signer options, and no tool takes a signer option", () => {
  for (const { path, command } of commands) {
    const tool = TOOLS.find((t) => t.command.join(" ") === path.join(" "))!
    const names = command.options.map((o) => o.attributeName())
    const writes = names.includes("dryRun")
    assert.equal(tool.kind, writes ? "write" : "read", tool.name)
    if (writes) for (const option of SIGNER_OPTIONS) assert.ok(names.includes(option), `${path.join(" ")} lacks ${option}`)
    for (const option of SIGNER_OPTIONS) assert.ok(!(option in toolShape(tool.name)), `${tool.name} takes ${option}`)
  }
})

test("every write tool's dryRun defaults to true", () => {
  for (const tool of TOOLS.filter((t) => t.kind === "write")) {
    const schema = inputJsonSchema(tool) as { properties: Record<string, { default?: unknown }> }
    assert.equal(schema.properties.dryRun?.default, true, tool.name)
  }
})
