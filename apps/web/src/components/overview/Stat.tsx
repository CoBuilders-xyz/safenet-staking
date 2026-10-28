import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { Figure, FigureSource } from "@/lib/figure"
import { cn } from "@/lib/utils"

interface StatProps<T> {
  label: string
  figure: Figure<T>
  format: (value: T) => ReactNode
  /** A line under the value: its window, its range, its date. */
  detail?: (value: T) => ReactNode
  /** Names where the value was read from. */
  source?: (source: FigureSource) => ReactNode
  tone?: "default" | "accent"
}

/**
 * One headline figure. Unavailable shows the word and the reason, never a zero or a dash a
 * reader could take for a value.
 */
export function Stat<T>({ label, figure, format, detail, source, tone = "default" }: StatProps<T>) {
  const { t } = useTranslation()
  return (
    <Card role="group" aria-label={label} className="flex min-h-[132px] flex-col gap-2 p-5">
      <div className="text-xs uppercase tracking-[0.06em] text-faint">{label}</div>
      {figure.state === "loading" && <Skeleton className="h-9 w-32" aria-label={t("overview.figure.loadingLabel", "Loading {{label}}", { label })} />}
      {figure.state === "unavailable" && (
        <>
          <div className="font-mono text-2xl tracking-tight">{t("overview.figure.unavailable", "Unavailable")}</div>
          <div className="text-xs leading-snug text-muted-foreground">{figure.reason}</div>
        </>
      )}
      {figure.state === "ready" && (
        <>
          <div
            className={cn(
              "font-mono text-[clamp(24px,3.2vw,32px)] leading-tight tracking-[-0.04em] tabular-nums",
              tone === "accent" && "text-accent-foreground",
            )}
          >
            {format(figure.value)}
          </div>
          {detail && <div className="text-[13px] leading-snug text-muted-foreground">{detail(figure.value)}</div>}
          {source && <div className="mt-auto text-xs text-faint">{source(figure.source)}</div>}
        </>
      )}
    </Card>
  )
}
