import QRCode from "qrcode"

/**
 * A prompt that does not echo, for keystore passwords and deliberate wallet confirmations. Without a terminal there is nothing to ask in, and the caller says so.
 */
export function terminalPasswordPrompt(signal?: AbortSignal): ((prompt: string) => Promise<string>) | undefined {
  const { stdin, stderr } = process
  if (!stdin.isTTY || !stderr.isTTY) return undefined
  return (prompt) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("Prompt cancelled"))
      let password = ""
      const previousRaw = stdin.isRaw
      let settled = false
      stderr.write(prompt)
      stdin.setRawMode(true)
      stdin.setEncoding("utf8")
      const done = (err?: Error) => {
        if (settled) return
        settled = true
        signal?.removeEventListener("abort", cancel)
        stdin.off("data", onData)
        stdin.off("end", closed)
        stdin.off("close", closed)
        stdin.off("error", failed)
        try { stdin.setRawMode(previousRaw) }
        catch { err ??= new Error("Could not restore terminal mode") }
        stdin.pause()
        stderr.write("\n")
        if (err) reject(err)
        else resolve(password)
      }
      const cancel = () => done(new Error("Prompt cancelled"))
      const closed = () => done(new Error("Password input closed"))
      const failed = () => done(new Error("Password input failed"))
      signal?.addEventListener("abort", cancel, { once: true })
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") return done()
          if (ch === "\u0003") return done(new Error("Cancelled at the password prompt"))
          if (ch === "\u007f" || ch === "\b") password = [...password].slice(0, -1).join("")
          else password += ch
        }
      }
      stdin.on("data", onData)
      stdin.once("end", closed)
      stdin.once("close", closed)
      stdin.once("error", failed)
      stdin.resume()
    })
}

/** Display pairing material only after the operator confirms terminal recording has stopped. */
export async function showWalletPairing(uri: string, signal: AbortSignal): Promise<void> {
  const prompt = terminalPasswordPrompt(signal)
  if (!prompt) throw new Error("WalletConnect needs an interactive terminal")
  const answer = await prompt("Pairing URI and QR are sensitive. Stop terminal recording. Type connect to display them: ")
  if (answer !== "connect") throw new Error("Wallet pairing cancelled")
  const qr = await QRCode.toString(uri, { type: "terminal", small: true })
  if (signal.aborted) throw new Error("Wallet pairing cancelled")
  process.stderr.write(`Scan this QR or paste the URI into your wallet app. Never share either:\n${qr}\n${uri}\n`)
}
