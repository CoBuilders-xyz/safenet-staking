import type { ReactNode } from "react"
import { Footer } from "@/components/layout/Footer"
import { restrictionCopy, type Restriction } from "@/lib/restriction"

interface RestrictedScreenProps {
  restriction: Restriction
  /** Buttons for what the visitor can do here, such as retry or disconnect. */
  actions?: ReactNode
}

/** The whole interface closed by one gate. It names the gate, why it refused, and what to do. */
export function RestrictedScreen({ restriction, actions }: RestrictedScreenProps) {
  const { title, gate, description, remedy } = restrictionCopy(restriction)
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex flex-1 items-center justify-center px-4">
        <div className="max-w-md text-center space-y-4" data-gate={restriction.gate} data-reason={restriction.reason}>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Closed by: {gate}</p>
          <p className="text-muted-foreground">{description}</p>
          <p>{remedy}</p>
          {actions && <div className="flex flex-wrap justify-center gap-3">{actions}</div>}
        </div>
      </main>
      <Footer />
    </div>
  )
}
