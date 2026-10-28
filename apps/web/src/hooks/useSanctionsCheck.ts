import { useQuery } from "@tanstack/react-query"
import type { Restriction } from "@/lib/restriction"

const sanctionsApiUrl = import.meta.env.VITE_SANCTIONS_API_URL as
  | string
  | undefined

interface SanctionsResult {
  allowed: boolean
  isLoading: boolean
  /** Why the gate is closed. Undefined while it is open or loading. */
  restriction?: Restriction
}

async function checkSanctions(): Promise<boolean> {
  const response = await fetch(sanctionsApiUrl as string)
  if (response.status === 403) return false
  if (!response.ok) throw new Error(`Sanctions check failed: ${response.status}`)
  return true
}

export function useSanctionsCheck(): SanctionsResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sanctions"],
    queryFn: checkSanctions,
    enabled: !!sanctionsApiUrl,
    retry: false,
    staleTime: Infinity,
  })

  if (!sanctionsApiUrl) return { allowed: true, isLoading: false }

  // Fail-closed: block on error
  if (isError) return { allowed: false, isLoading: false, restriction: { gate: "sanctionsApi", reason: "unavailable" } }

  if (data === false) return { allowed: false, isLoading, restriction: { gate: "sanctionsApi", reason: "refused" } }

  return { allowed: true, isLoading }
}
