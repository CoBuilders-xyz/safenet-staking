import { cn } from "@/lib/utils"

interface SegmentedProps<K extends string> {
  /** Names the group for assistive technology, and shows before the options. */
  label: string
  options: readonly { key: K; label: string }[]
  value: K
  onChange: (key: K) => void
}

/** A row of toggle buttons, one pressed: a window, a sort order or a filter. */
export function Segmented<K extends string>({ label, options, value, onChange }: SegmentedProps<K>) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground" aria-hidden="true">
        {label}
      </span>
      <div role="group" aria-label={label} className="inline-flex flex-wrap rounded-md border border-border p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={o.key === value}
            onClick={() => onChange(o.key)}
            className={cn(
              "rounded-sm px-2.5 py-1 transition-colors",
              o.key === value ? "bg-surface-2 font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
