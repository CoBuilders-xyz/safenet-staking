import { defineConfig } from "tsup"

export default defineConfig({
  // The binary, the library the MCP server calls, and the program it checks its tools against.
  // Each library entry ships with its declarations.
  entry: { index: "src/index.ts", "lib/index": "src/lib/index.ts", program: "src/cli.ts" },
  dts: { entry: { "lib/index": "src/lib/index.ts", program: "src/cli.ts" } },
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  sourcemap: true,
  // packages/core ships TypeScript source, which node cannot run, so it is bundled in.
  // The published dependencies stay external and resolve from node_modules.
  noExternal: ["@cobuilders/safenet-core"],
  esbuildOptions(options) {
    // The map keeps file and line references for stack traces, but not the TypeScript itself:
    // the private workspace sources it would carry stay out of the npm tarball.
    options.sourcesContent = false
  },
})
