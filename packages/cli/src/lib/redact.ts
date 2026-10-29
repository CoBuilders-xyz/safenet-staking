/**
 * Taking what may be a secret out of text that leaves the process.
 *
 * An RPC URL can carry a key in its path or its query, and a value typed in the wrong place can
 * be a private key. The CLI prints these helpers' output on stderr; the MCP server returns it to
 * the model. Both add their own advice for a refused log scan, because only they know how the
 * endpoint is set: a flag in one, an environment variable in the other.
 */
import { BaseError } from "viem"
import { SafenetError } from "./errors.js"
import { ScanError } from "./scan.js"

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

/** Every URL in the text replaced by `<url>`. */
export function redactUrls(text: string): string {
  return text.replace(/wc:[^\s"'<>]+/gi, "<walletconnect-uri>").replace(URL_PATTERN, "<url>")
}

/**
 * Text with anything that may be a secret taken out. A misplaced flag in `--flag=value` form,
 * such as `--private-key=<key>`, is repeated whole by a parser that reports it as unknown; a key
 * typed where an argument belongs is repeated by a validation message. So the value after `=`
 * goes, as do URLs and runs of 64 or more hex digits. A usage error never needs a transaction
 * hash, so nothing real is lost.
 */
export function scrubSecrets(text: string): string {
  return redactUrls(text.replace(/(^|[\s'"])(-{1,2}[A-Za-z0-9][\w-]*)=[^\s'"]*/g, "$1$2=<redacted>"))
    .replace(/(0x)?[0-9a-fA-F]{64,}/g, "<redacted>")
}

/**
 * One plain sentence for an error, with any URL removed. `archiveAdvice` ends the sentence for a
 * refused log scan, and says how the caller sets an archive endpoint.
 */
export function errorSentence(err: unknown, archiveAdvice: string): string {
  let text: string
  if (err instanceof ScanError) text = `${err.message}; ${archiveAdvice}`
  else if (err instanceof SafenetError) text = err.message
  else if (err instanceof BaseError) text = `The Mainnet RPC request failed: ${err.shortMessage}`
  else if (err instanceof Error) text = err.message
  else text = String(err)
  const line = redactUrls(text.split("\n")[0] ?? "").trim()
  if (line.length === 0) return "Something failed without a message."
  return /[.!?]$/.test(line) ? line : `${line}.`
}
