/**
 * Typed GraphQL documents for both subgraphs.
 *
 *   pnpm codegen         regenerate src/graphql/<chain>/generated.ts
 *   pnpm codegen:check   regenerate into a temporary directory and fail if the committed files differ
 *
 * The schema is each subgraph package's schema.graphql, turned into the schema graph-node serves
 * by scripts/subgraph-api-schema.ts. The two subgraphs are separate schemas, so each chain gets
 * its own output file and its own documents.
 *
 * CODEGEN_OUT moves the output directory; codegen:check uses it.
 */
import { resolve } from "node:path"
import type { CodegenConfig } from "@graphql-codegen/cli"
import { subgraphApiSchema } from "./scripts/subgraph-api-schema"

const OUT = process.env.CODEGEN_OUT ?? "src/graphql"
const CHAINS = ["mainnet", "gnosis"] as const

const config: CodegenConfig = {
  overwrite: true,
  generates: Object.fromEntries(
    CHAINS.map((chain) => [
      `${OUT}/${chain}/generated.ts`,
      {
        schema: subgraphApiSchema(resolve(import.meta.dirname, `../../packages/subgraph-${chain}/schema.graphql`)),
        documents: `src/graphql/${chain}/*.graphql`,
        plugins: [
          { add: { content: "/* GENERATED FILE. Do not edit by hand. Run `pnpm codegen` in apps/web. */" } },
          "typescript-operations",
          "typed-document-node",
        ],
        config: {
          // graph-node serialises these as strings: BigInt and BigDecimal to keep precision, Bytes
          // as 0x-prefixed hex.
          scalars: {
            BigInt: "string",
            BigDecimal: "string",
            Bytes: "string",
            Int8: "string",
            Timestamp: "string",
          },
          enumsAsTypes: true,
          useTypeImports: true,
        },
      },
    ]),
  ),
}

export default config
