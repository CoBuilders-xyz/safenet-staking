import { defineConfig } from "vite"
import { cloudflare } from "@cloudflare/vite-plugin"

export default defineConfig({
  plugins: [cloudflare()],
  server: { host: "127.0.0.1", port: Number(process.env.API_PORT || 8797), strictPort: true },
})
