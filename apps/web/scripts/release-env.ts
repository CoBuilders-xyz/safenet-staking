import { parseEnv } from "node:util"

/** Release inputs: committed public values plus the one explicit COB-566 browser key. */
export function releaseEnvironment(source: string, graphApiKey?: string): Record<string, string | undefined> {
  const values = parseEnv(source)
  for (const key of Object.keys(values)) {
    if (!key.startsWith("VITE_")) throw new Error("build.env must contain only VITE_ variables")
  }
  if (values.VITE_GRAPH_API_KEY) throw new Error("Inject VITE_GRAPH_API_KEY through the environment, not build.env")
  if (graphApiKey?.trim()) values.VITE_GRAPH_API_KEY = graphApiKey.trim()
  return values
}
