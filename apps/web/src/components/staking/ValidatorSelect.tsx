import type { Address } from "viem"
import { useValidators } from "@/hooks/useValidators"

interface ValidatorSelectProps {
  value: Address | undefined
  onChange: (validator: Address) => void
  disabled?: boolean
}

/** Active validators, by label, with their commission. Nothing is chosen for the user. */
export function ValidatorSelect({ value, onChange, disabled }: ValidatorSelectProps) {
  const { data: validators, isLoading, error } = useValidators()
  const active = (validators ?? [])
    .filter((v) => v.isActive)
    .sort((a, b) => a.label.localeCompare(b.label))

  return (
    <div className="space-y-2">
      <label htmlFor="validator-select" className="text-sm font-medium">
        Validator
      </label>
      <select
        id="validator-select"
        className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-base transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
        value={value ?? ""}
        disabled={disabled || isLoading || active.length === 0}
        onChange={(e) => onChange(e.target.value as Address)}
      >
        <option value="" disabled>
          {isLoading ? "Loading validators…" : "Choose a validator"}
        </option>
        {active.map((v) => (
          <option key={v.address} value={v.address}>
            {v.label} · {v.commission}% commission
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-destructive">The validator list could not be loaded.</p>}
    </div>
  )
}
