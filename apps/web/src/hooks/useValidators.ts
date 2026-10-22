import { useQuery } from "@tanstack/react-query"
import { type Address, getAddress } from "viem"
import { SEF_DATA } from "@cobuilders/safenet-core"

export interface ValidatorInfo {
  address: Address
  isActive: boolean
  label: string
  commission: number
  /** SEF's 14-day rate in percent, two decimals. Null when SEF publishes no rate, never 0. */
  participationRate: number | null
}

interface RawValidator {
  address: string
  label: string
  commission: number
  is_active: boolean
  participation_rate_14d: number | null
}

function isValidEntry(v: unknown): v is RawValidator {
  if (typeof v !== "object" || v === null) return false
  const obj = v as Record<string, unknown>
  return (
    typeof obj.address === "string" &&
    typeof obj.label === "string"
  )
}

async function fetchValidators(): Promise<ValidatorInfo[]> {
  const url =
    import.meta.env.VITE_VALIDATOR_INFO_URL || SEF_DATA.validatorInfo
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `Failed to fetch validators: ${res.status}`
    )
  }
  const text = await res.text()
  // Sanitize malformed JSON: strip empty array slots (,\s*,)
  // and trailing commas before ] or }
  const sanitized = text
    .replace(/,\s*,/g, ",")
    .replace(/,\s*([}\]])/g, "$1")
  const json: unknown = JSON.parse(sanitized)
  if (!Array.isArray(json)) {
    throw new Error("Invalid validator data format")
  }
  return json.filter(isValidEntry).map((v) => ({
    address: getAddress(v.address),
    isActive: v.is_active ?? true,
    label: v.label,
    commission:
      Math.round((v.commission ?? 0) * 100 * 100) / 100,
    participationRate:
      typeof v.participation_rate_14d === "number"
        ? Math.round(v.participation_rate_14d * 100 * 100) / 100
        : null,
  }))
}

export function useValidators() {
  return useQuery({
    queryKey: ["validators"],
    queryFn: fetchValidators,
    staleTime: 5 * 60 * 1000,
  })
}

/**
 * Synchronous lookup helper for finding a validator by
 * address from an already-loaded validators array.
 */
export function findValidator(
  validators: ValidatorInfo[] | undefined,
  address: string
): ValidatorInfo | null {
  if (!validators) return null
  const target = address.toLowerCase()
  return (
    validators.find(
      (v) => v.address.toLowerCase() === target
    ) ?? null
  )
}
