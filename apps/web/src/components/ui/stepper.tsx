import { cn } from "@/lib/utils"

interface StepperProps {
  steps: readonly string[]
  /** Index of the step in progress. Steps before it show as done. */
  current: number
}

/** Horizontal step indicator: numbered circles joined by lines. Done steps show a tick. */
export function Stepper({ steps, current }: StepperProps) {
  return (
    <ol aria-label="Progress" className="flex items-center gap-2">
      {steps.map((label, i) => {
        const done = i < current
        const active = i === current
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className="flex flex-1 items-center gap-2 last:flex-none"
          >
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium tabular-nums",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              <span aria-hidden="true">{done ? "✓" : i + 1}</span>
            </span>
            <span className={cn("text-sm", active ? "font-medium" : "text-muted-foreground")}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="h-px flex-1 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}
