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
      stderr.write(prompt)
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding("utf8")
      const done = (err?: Error) => {
        signal?.removeEventListener("abort", cancel)
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off("data", onData)
        stderr.write("\n")
        if (err) reject(err)
        else resolve(password)
      }
      const cancel = () => done(new Error("Prompt cancelled"))
      signal?.addEventListener("abort", cancel, { once: true })
      const onData = (chunk: string) => {
        for (const ch of chunk) {
          if (ch === "\r" || ch === "\n") return done()
          if (ch === "\u0003") return done(new Error("Cancelled at the password prompt"))
          if (ch === "\u007f" || ch === "\b") password = password.slice(0, -1)
          else password += ch
        }
      }
      stdin.on("data", onData)
    })
}
