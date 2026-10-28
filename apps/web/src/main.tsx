import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { WagmiProvider } from "wagmi"
import { QueryClientProvider } from "@tanstack/react-query"
import { config } from "@/config/wagmi"
import { queryClient } from "@/config/queryClient"
import { ToastProvider } from "@/hooks/ToastProvider"
import { initI18n } from "@/i18n"
import App from "./App"
import "./index.css"

function render() {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <WagmiProvider config={config} reconnectOnMount={false}>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>
            <App />
          </ToastProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  )
}

// The first render waits for the reader's catalogue, so it is already in their language. A
// catalogue that fails to load leaves the page in English, never blank.
void initI18n().catch(() => undefined).finally(render)
