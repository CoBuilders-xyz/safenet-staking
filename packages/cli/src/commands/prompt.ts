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
