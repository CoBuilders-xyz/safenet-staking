/**
 * The one origin a browser and MetaMask talk to. `fork:up` starts it detached. Three routes:
 *
 *   /rpc         POST JSON-RPC to Anvil, with CORS headers, so MetaMask's extension can call it
 *   /rewards/*   the generated proof files and latest.json, read from disk on each request
 *   everything else, and the HMR websocket, to the Vite dev server this process starts
 *
 * Vite runs with VITE_RPC_URL and VITE_REWARDS_BASE_URL under the proxy origin, so the app reads
 * the fork and the generated proofs through the same door as MetaMask, and with the validator
 * list from the same source as the proofs. Vite refuses a Host header it does not know, so it
 * sees its own.
 *
 * An Anvil error on a read it forwarded to the archive endpoint can name that endpoint, whose
 * URL carries a key. So Anvil's answers are not streamed: each is read whole and every URL in it
 * replaced before it goes to the client. A JSON-RPC result is hex and numbers; it holds no URL.
 */
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http"
import { connect } from "node:net"
import { normalize, resolve, sep } from "node:path"
import { createInterface } from "node:readline"
import { PROXY_RECORD, readRecord, redact, removeRecord, self, writeRecord, type ProxyRecord } from "./processes"
import { ANVIL_PORT, PROXY_HOST, PROXY_ORIGIN, PROXY_PORT, REWARDS_DIR, SEF_SOURCE, WEB_DIR, WEB_PORT } from "./settings"

const stamp = () => new Date().toISOString()

const ANVIL = { host: "127.0.0.1", port: ANVIL_PORT }
const VITE = { host: "127.0.0.1", port: WEB_PORT }

const vite = spawn(
  resolve(WEB_DIR, "node_modules/.bin/vite"),
  ["--host", VITE.host, "--port", String(VITE.port), "--strictPort"],
  {
    cwd: WEB_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      VITE_RPC_URL: `${PROXY_ORIGIN}/rpc`,
      // Empty, so a fallback in .env.local cannot send a read to the real chain.
      VITE_RPC_URL_FALLBACK_1: "",
      VITE_RPC_URL_FALLBACK_2: "",
      VITE_REWARDS_BASE_URL: `${PROXY_ORIGIN}/rewards`,
      VITE_VALIDATOR_INFO_URL: SEF_SOURCE.validatorInfo,
    },
  },
)
createInterface({ input: vite.stdout }).on("line", (line) => console.log(`vite: ${redact(line)}`))
createInterface({ input: vite.stderr }).on("line", (line) => console.error(`vite: ${redact(line)}`))
vite.on("error", (err) => {
  console.error(`${stamp()} vite could not start (${redact(err.message)})`)
  shutdown(1)
})
vite.on("exit", (code, signal) => {
  console.error(`${stamp()} vite exited (${signal ?? code}); stopping the proxy`)
  shutdown(1)
})

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

/** Streams a request to Vite and its answer back. */
function forwardToVite(req: IncomingMessage, res: ServerResponse): void {
  const headers = { ...req.headers, host: `${VITE.host}:${VITE.port}` }
  const upstream = request({ ...VITE, method: req.method, path: req.url ?? "/", headers }, (answer) => {
    res.writeHead(answer.statusCode ?? 502, answer.headers)
    answer.pipe(res)
  })
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502)
    res.end("upstream not ready")
  })
  req.pipe(upstream)
}

/** Sends a JSON-RPC request to Anvil and answers with its reply, read whole and redacted. */
function forwardToAnvil(req: IncomingMessage, res: ServerResponse): void {
  const upstream = request({ ...ANVIL, method: "POST", path: "/", headers: { "content-type": "application/json" } }, (answer) => {
    const chunks: Buffer[] = []
    answer.on("data", (chunk: Buffer) => chunks.push(chunk))
    answer.on("end", () => {
      const body = redact(Buffer.concat(chunks).toString("utf8"))
      res.writeHead(answer.statusCode ?? 502, {
        ...cors,
        "content-type": answer.headers["content-type"] ?? "application/json",
        "content-length": Buffer.byteLength(body),
      })
      res.end(body)
    })
    answer.on("error", () => {
      if (!res.headersSent) res.writeHead(502, cors)
      res.end("upstream failed")
    })
  })
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, cors)
    res.end("upstream not ready")
  })
  req.pipe(upstream)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://proxy.invalid")
  if (url.pathname === "/rpc") {
    if (req.method === "OPTIONS") return res.writeHead(204, cors).end()
    if (req.method !== "POST") return res.writeHead(405, cors).end("POST JSON-RPC here")
    return forwardToAnvil(req, res)
  }
  if (url.pathname.startsWith("/rewards/")) {
    const file = normalize(resolve(REWARDS_DIR, "." + url.pathname.slice("/rewards".length)))
    if (!file.startsWith(REWARDS_DIR + sep)) return res.writeHead(400, cors).end()
    try {
      const body = await readFile(file)
      return res.writeHead(200, { ...cors, "content-type": "application/json", "cache-control": "no-store" }).end(body)
    } catch {
      return res.writeHead(404, cors).end("{}")
    }
  }
  forwardToVite(req, res)
})

// Vite's HMR websocket.
server.on("upgrade", (req, socket, head) => {
  const up = connect(VITE.port, VITE.host, () => {
    const headers = { ...req.headers, host: `${VITE.host}:${VITE.port}` }
    const lines = Object.entries(headers).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`)
    up.write(head)
    socket.pipe(up).pipe(socket)
  })
  up.on("error", () => socket.destroy())
  socket.on("error", () => up.destroy())
})

server.on("error", (err) => {
  console.error(`${stamp()} proxy: ${redact(err.message)}`)
  shutdown(1)
})

// Without its record this proxy could never be told from someone else's, and `fork:down` could
// never stop it. So when the record cannot be written, it stops, with its Vite.
server.listen(PROXY_PORT, PROXY_HOST, () => {
  try {
    const record: ProxyRecord = {
      proxy: self(process.pid),
      vite: self(vite.pid ?? 0),
      host: PROXY_HOST,
      proxyPort: PROXY_PORT,
      webPort: WEB_PORT,
      anvilPort: ANVIL_PORT,
      origin: PROXY_ORIGIN,
      validatorInfo: SEF_SOURCE.validatorInfo,
    }
    writeRecord(PROXY_RECORD, record)
  } catch (err) {
    console.error(`${stamp()} cannot record the proxy (${redact(err instanceof Error ? err.message : String(err))}); stopping`)
    shutdown(1)
    return
  }
  console.log(`${stamp()} proxy on ${PROXY_HOST}:${PROXY_PORT}, origin ${PROXY_ORIGIN}, vite on ${VITE.host}:${VITE.port}`)
})

let stopping = false
function shutdown(code: number): void {
  if (stopping) return
  stopping = true
  // Unless the record already names another proxy's.
  if (readRecord<ProxyRecord>(PROXY_RECORD)?.proxy.pid === process.pid) removeRecord(PROXY_RECORD)
  if (vite.exitCode === null && vite.signalCode === null) vite.kill("SIGTERM")
  server.closeAllConnections()
  server.close(() => process.exit(code))
  setTimeout(() => process.exit(code), 3_000).unref()
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0))
}
