// core runs in node (scripts, verify:abis, metrics). No React, no browser globals.
import globals from "globals"
import { defineConfig } from "eslint/config"
import base from "../../eslint.config.base.js"

export default defineConfig([
  ...base,
  { files: ["**/*.ts"], languageOptions: { globals: globals.node } },
])
