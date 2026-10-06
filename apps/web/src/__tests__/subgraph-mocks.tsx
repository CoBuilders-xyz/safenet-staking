import type { ReactNode } from "react"
import { vi } from "vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { DocumentNode, OperationDefinitionNode } from "graphql"
import { SUBGRAPH_STALE_AFTER_SECONDS } from "@cobuilders/safenet-core"

/**
 * A small GraphQL mock: tests replace graphql-request's `request` with `mockRequest` and answer
 * per operation name, so the client, the freshness rule and the hooks all run for real.
 *
 *   vi.mock("graphql-request", () => ({ request: (o: unknown) => mockRequest(o) }))
 */
export const mockRequest = vi.fn()

type Answer = unknown | Error

/** Answer each operation by name. An Error is thrown, as a failed request would. */
export function answerOperations(answers: Record<string, Answer>) {
  mockRequest.mockImplementation(async ({ document }: { document: DocumentNode }) => {
    const op = document.definitions.find((d): d is OperationDefinitionNode => d.kind === "OperationDefinition")
    const name = op?.name?.value ?? ""
    if (!(name in answers)) throw new Error(`no mock answer for ${name}`)
    const answer = answers[name]
    if (answer instanceof Error) throw answer
    return answer
  })
}

/** `_meta` for a subgraph whose last indexed block is `ageSeconds` old. */
export function meta(ageSeconds = 30, block = 25_000_000, hasIndexingErrors = false) {
  return {
    block: { number: block, timestamp: Math.floor(Date.now() / 1000) - ageSeconds },
    hasIndexingErrors,
  }
}

/** Old enough to fail the freshness rule. */
export const STALE_AGE = SUBGRAPH_STALE_AFTER_SECONDS + 60

/** A fresh QueryClient per test, so no answer leaks between tests, and the client to drive it. */
export function queryClientAndWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return { client, Wrapper }
}

export function queryWrapper() {
  return queryClientAndWrapper().Wrapper
}

/** A wagmi-like read result. */
export function read<T>(data: T | undefined, error: unknown = null) {
  return { data, error, refetch: vi.fn() }
}
