import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import type { Figure } from "@/lib/figure"
import { cn } from "@/lib/utils"

interface OverviewSectionProps {
  title: string
  /** Where the figures in this section come from. Shown under the title. */
  source?: ReactNode
  children: ReactNode
  className?: string
}

/** A card on the overview. Every section names its source, so a reader can check it. */
export function OverviewSection({ title, source, children, className }: OverviewSectionProps) {
  const id = `overview-section-${title.toLowerCase().replace(/\W+/g, "-")}`
  return (
    <Card role="region" aria-labelledby={id} className={className}>
      <CardHeader className="pb-4">
        <CardTitle id={id} className="text-sm font-normal uppercase tracking-[0.04em] text-faint">
          {title}
        </CardTitle>
        {source && <p className="text-xs text-muted-foreground">{source}</p>}
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  )
}

/**
 * Keeps one section's failure inside that section. A render error in a section shows this
 * message in its place and the rest of the page keeps working.
 */
export function SectionBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={(retry) => (
        <OverviewSection title={title}>
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 p-3 text-sm">
            <span>This section could not be shown.</span>
            <Button size="sm" variant="outline" onClick={retry}>
              Retry
            </Button>
          </div>
        </OverviewSection>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}

interface FigureValueProps<T> {
  figure: Figure<T>
  format: (value: T) => ReactNode
  /** Classes for the skeleton shown while loading. */
  skeletonClassName?: string
}

/** A figure's value, a skeleton while it loads, or "Unavailable" with the reason beside it. */
export function FigureValue<T>({ figure, format, skeletonClassName }: FigureValueProps<T>) {
  if (figure.state === "loading") {
    return <Skeleton className={cn("inline-block h-5 w-24 align-middle", skeletonClassName)} aria-label="Loading" />
  }
  if (figure.state === "unavailable") {
    return (
      <span>
        Unavailable
        <span className="block font-sans text-xs font-normal text-muted-foreground">{figure.reason}</span>
      </span>
    )
  }
  return <>{format(figure.value)}</>
}
