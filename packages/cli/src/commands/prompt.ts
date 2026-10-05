/**
 * A password prompt that does not echo, on the process's terminal. Only the keystore option
 * uses it. Without a terminal there is nothing to ask in, and the caller says so.
 */
export function terminalPasswordPrompt(): ((prompt: string) => Promise<string>) | undefined {
  const { stdin, stderr } = process
  if (!stdin.isTTY || !stderr.isTTY) return undefined
  return (prompt) =>
    new Promise((resolve, reject) => {
      let password = ""
      stderr.write(prompt)
      stdin.setRawMode(true)
      stdin.resume()
      stdin.setEncoding("utf8")
      const done = (err?: Error) => {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off("data", onData)
        stderr.write("\n")
        if (err) reject(err)
        else resolve(password)
      }
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
