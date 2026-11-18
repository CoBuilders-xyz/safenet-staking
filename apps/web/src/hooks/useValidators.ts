import { useQuery } from "@tanstack/react-query"
import { type Address, getAddress, isAddress } from "viem"
import { SEF_DATA } from "@cobuilders/safenet-core"
import { truncateAddress } from "@/lib/format"

export interface ValidatorInfo {
  address: Address
  isActive: boolean
  /** The display name. Never empty: a missing or blank label becomes the short address. */
  label: string
  commission: number
  /** SEF's 14-day rate in percent, two decimals. Null when SEF publishes no rate, never 0. */
  participationRate: number | null
}

interface RawValidator {
  address: string
  label?: unknown
  commission: number
  is_active: boolean
  participation_rate_14d: number | null
}

function isValidEntry(v: unknown): v is RawValidator {
  if (typeof v !== "object" || v === null) return false
  const obj = v as Record<string, unknown>
  // A row the address check rejects is skipped, so one bad row cannot fail the whole list.
  return typeof obj.address === "string" && isAddress(obj.address, { strict: false })
}

/**
 * The label as published, or the short address when it is missing, blank or the address itself,
 * which the REST API sends when SEF's label is blank. An empty label would render an empty name,
 * and the card's link to the validator page would have nothing to click.
 */
function displayLabel(label: unknown, address: Address): string {
  if (typeof label !== "string" || label.trim() === "") return truncateAddress(address)
  return label.trim().toLowerCase() === address.toLowerCase() ? truncateAddress(address) : label
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
  return json.filter(isValidEntry).map((v) => {
    const address = getAddress(v.address)
    return {
      address,
      isActive: v.is_active ?? true,
      label: displayLabel(v.label, address),
      commission:
        Math.round((v.commission ?? 0) * 100 * 100) / 100,
      participationRate:
        typeof v.participation_rate_14d === "number"
          ? Math.round(v.participation_rate_14d * 100 * 100) / 100
          : null,
    }
  })
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
