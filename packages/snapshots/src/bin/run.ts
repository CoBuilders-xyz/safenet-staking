/**
 * What the three scripts share: failing with one sentence that carries no secret, and writing
 * the step outputs when they run in GitHub Actions.
 */
import { appendFileSync } from "node:fs"
import { redactUrls } from "@cobuilders/safenet-cli/lib"
import { redact } from "@cobuilders/safenet-core/parity"
import { BaseError } from "viem"

/**
 * The first line of an error, with every URL out: an RPC URL carries its key in the path.
 * viem's long message repeats the request and the URL, so its short message is used.
 */
export function sentence(err: unknown): string {
  const text = err instanceof BaseError ? err.shortMessage : err instanceof Error ? err.message : String(err)
  return redact(redactUrls(text.split("\n")[0] ?? "")).trim() || "failed without a message"
}

export function fail(script: string, message: string): never {
  const line = redact(redactUrls(message))
  console.error(`${script}: ${line}`)
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=${script}::${line.replaceAll("\n", " ")}`)
  process.exit(1)
}

/** Runs `main`, and turns any error into `fail`. */
export function run(script: string, main: () => Promise<void>): void {
  main().catch((err: unknown) => fail(script, sentence(err)))
}

/** A `name=value` line for the next steps of the job. Does nothing outside Actions. */
export function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
