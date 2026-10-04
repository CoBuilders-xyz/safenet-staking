import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

interface RewardsSectionProps {
  title: string
  /** Where the numbers in this section come from. Shown under the title. */
  source: ReactNode
  children: ReactNode
}

/** A card on the Rewards page. Every section names its source, so a reader can check it. */
export function RewardsSection({ title, source, children }: RewardsSectionProps) {
  const id = `rewards-section-${title.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <Card role="region" aria-labelledby={id}>
      <CardHeader>
        <CardTitle id={id}>{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{source}</p>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

export function SectionLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10" />
      ))}
    </div>
  )
}

/** A section-scoped error: the rest of the page keeps working. */
export function SectionError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 p-3 text-sm">
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function SectionNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

interface StatRowProps {
  label: string
  children: ReactNode
  hint?: ReactNode
}

/** A label and its value on one line; the value is what a test or a reader looks up. */
export function StatRow({ label, children, hint }: StatRowProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="ml-auto text-right font-mono font-medium tabular-nums">
        {children}
        {hint && <span className="block font-sans text-xs font-normal text-muted-foreground">{hint}</span>}
      </dd>
    </div>
  )
}
