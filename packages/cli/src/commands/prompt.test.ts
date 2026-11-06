import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { test } from "node:test"
import { showWalletPairing, terminalPasswordPrompt } from "./prompt.js"

async function terminal(run: (input: FakeInput, output: string[]) => Promise<void>, raw = false) {
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin")!
  const stderr = Object.getOwnPropertyDescriptor(process, "stderr")!
  const input = new FakeInput(raw)
  const output: string[] = []
  Object.defineProperty(process, "stdin", { configurable: true, value: input })
  Object.defineProperty(process, "stderr", { configurable: true, value: {
    isTTY: true, write: (value: string) => { output.push(value); return true },
  } })
  try { await run(input, output) }
  finally {
    Object.defineProperty(process, "stdin", stdin)
    Object.defineProperty(process, "stderr", stderr)
  }
}

class FakeInput extends EventEmitter {
  isTTY = true
  paused = true
  constructor(public isRaw: boolean) { super() }
  setRawMode(raw: boolean) { this.isRaw = raw; return this }
  resume() { this.paused = false; return this }
  pause() { this.paused = true; return this }
  setEncoding() { return this }
}

test("password corrections remove a complete Unicode code point without echo", async () => {
  await terminal(async (input, output) => {
    const result = terminalPasswordPrompt()!("Password: ")
    input.emit("data", "a😀\u007fx\r\n")
    assert.equal(await result, "ax")
    assert.deepEqual(output, ["Password: ", "\n"])
    assert.equal(input.isRaw, false)
    assert.equal(input.paused, true)
    assert.deepEqual(input.eventNames(), [])
  })
})

test("completion restores a previously enabled raw mode", async () => {
  await terminal(async (input) => {
    const result = terminalPasswordPrompt()!("Password: ")
    input.emit("data", "\r")
    assert.equal(await result, "")
    assert.equal(input.isRaw, true)
  }, true)
})

for (const event of ["end", "close", "error"] as const) {
  test(`input ${event} rejects once and removes prompt listeners`, async () => {
    await terminal(async (input, output) => {
      const controller = new AbortController()
      const result = terminalPasswordPrompt(controller.signal)!("Password: ")
      const rejection = assert.rejects(result, /Password input (closed|failed)/)
      input.emit(event, new Error("fixture-sensitive-input"))
      controller.abort()
      await rejection
      assert.equal(input.isRaw, false)
      assert.equal(input.paused, true)
      assert.deepEqual(input.eventNames(), [])
      assert.deepEqual(output, ["Password: ", "\n"])
    })
  })
}

test("Ctrl-C and abort cancel without exposing input or retaining listeners", async () => {
  for (const abort of [false, true]) await terminal(async (input, output) => {
    const controller = new AbortController()
    const result = terminalPasswordPrompt(controller.signal)!("Password: ")
    const rejection = assert.rejects(result, /[Cc]ancelled/)
    input.emit("data", "fixture-password")
    if (abort) controller.abort()
    else input.emit("data", "\u0003")
    await rejection
    assert.deepEqual(input.eventNames(), [])
    assert.deepEqual(output, ["Password: ", "\n"])
    assert.equal(input.isRaw, false)
  })
})

test("a cancelled signal does not enter raw mode or write the prompt", async () => {
  await terminal(async (input, output) => {
    await assert.rejects(terminalPasswordPrompt(AbortSignal.abort())!("Password: "), /cancelled/)
    assert.equal(input.isRaw, false)
    assert.deepEqual(output, [])
    assert.deepEqual(input.eventNames(), [])
  })
})

test("pairing writes a terminal QR and URI to stderr only after connect confirmation", async () => {
  await terminal(async (input, output) => {
    const uri = "wc:unit-test-pairing@2?symKey=unit-test-only"
    const result = showWalletPairing(uri, new AbortController().signal)
    assert.equal(output.length, 1)
    assert.ok(!output.join("").includes(uri))
    input.emit("data", "connect\r")
    await result
    const rendered = output.join("")
    assert.match(rendered, /Scan this QR/)
    assert.ok(rendered.includes(uri))
    assert.match(rendered, /[▀▄█]/)
  })
})

test("pairing refusal and cancellation never display QR or URI", async () => {
  for (const abort of [false, true]) await terminal(async (input, output) => {
    const controller = new AbortController()
    const uri = "wc:unit-test-sensitive-pairing"
    const result = showWalletPairing(uri, controller.signal)
    const rejection = assert.rejects(result, /cancelled/)
    if (abort) controller.abort()
    else input.emit("data", "no\r")
    await rejection
    assert.ok(!output.join("").includes(uri))
    assert.doesNotMatch(output.join(""), /[▀▄█]/)
  })
})
