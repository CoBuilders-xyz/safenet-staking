import { existsSync, readFileSync } from "node:fs"
import path from "path"
import { parseEnv } from "node:util"
import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const safeAppHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers": "X-Requested-With, content-type, Authorization",
  // Chrome's Private Network Access check: without this, a public origin
  // (e.g. https://app.safe.global) fetching a loopback address like
  // localhost is blocked even with a permissive Access-Control-Allow-Origin.
  "Access-Control-Allow-Private-Network": "true",
  "Content-Security-Policy": "frame-ancestors 'self' https://app.safe.global",
}

// Vite installs its own CORS middleware before plugin middlewares run (its
// `server.cors` default is an origin allowlist, not `false`, despite what
// the type docs say), which is why `cors: false` below is required — without
// it, Vite's own preflight response wins and never sees our custom headers.
// And `server.headers` isn't a blanket middleware; it's merged in only where
// Vite's static file serving explicitly threads it through, which an
// OPTIONS preflight never reaches — so this middleware has to set every
// header itself rather than relying on `headers` to cover OPTIONS too.
function respondToPreflight(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      for (const [key, value] of Object.entries(safeAppHeaders)) {
        res.setHeader(key, value)
      }
      res.end()
      return
    }
    next()
  })
}

const repoRoot = path.resolve(__dirname, "../..")

// One port per worktree: WEB_PORT from .env.ports at the repository root, which
// scripts/setup.sh writes. An exported WEB_PORT wins, and `--port` wins over both, which is
// how the e2e suite runs on its own port. Without either, Vite's default.
const portsFile = path.join(repoRoot, ".env.ports")
const ports = existsSync(portsFile) ? parseEnv(readFileSync(portsFile, "utf8")) : {}
const webPort = process.env.WEB_PORT ?? ports.WEB_PORT

// The local graph-node's query port, from the same file. core uses it only for a chain whose
// default endpoint is the local graph-node. Today both defaults are Studio deployments, and the
// local node is reached by setting VITE_SUBGRAPH_URL_* to its URL.
const graphNodePort = process.env.GRAPH_NODE_PORT ?? ports.GRAPH_NODE_PORT ?? ""

export default defineConfig({
  base: './',
  // Env lives at the repository root, where `pnpm env:pull` writes .env.local, so dev and
  // build read the same file as the Node scripts. Vite still exposes only VITE_ values to the
  // bundle; `pnpm check:browser` fails if a value from .env.local reaches dist.
  envDir: repoRoot,
  define: {
    "import.meta.env.VITE_GRAPH_NODE_PORT": JSON.stringify(graphNodePort),
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'inject-app-url',
      transformIndexHtml: (html) =>
        html.replace(/%VITE_APP_URL%/g, process.env.VITE_APP_URL ?? ''),
    },
    {
      name: 'private-network-access-preflight',
      configureServer: respondToPreflight,
      configurePreviewServer: respondToPreflight,
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Disabled so our own preflight middleware (below) is what answers
    // OPTIONS requests — Vite's built-in CORS handling runs earlier and
    // would otherwise short-circuit the Private Network Access preflight
    // before our headers get set.
    cors: false,
    headers: safeAppHeaders,
    port: webPort ? Number(webPort) : undefined,
  },
  preview: {
    cors: false,
    headers: safeAppHeaders,
  },
  build: {
    rollupOptions: {
      output: {
        // Split the always-used React runtime without pulling lazy dialogs or tabs into it.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react"
        },
      },
    },
  },
})
