import { writeFileSync } from "node:fs"
import { deploySecrets } from "../src/deploy-secrets.js"

// Writes the secrets file for `cf deploy --secrets-file`. The workflow passes the path and removes
// the file afterwards. Prints no value.
const path = process.argv[2]
if (!path) throw new Error("Usage: deploy-secrets.ts <output path>")
try {
  writeFileSync(path, JSON.stringify(deploySecrets(process.env)), { mode: 0o600 })
} catch (error) {
  console.error(`::error::${error instanceof Error ? error.message : "Could not write the secrets file"}`)
  process.exit(1)
}
