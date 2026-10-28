import { useTranslation } from "react-i18next"
import { useRef, useState, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { definition, type GlossaryTerm } from "@/lib/glossary"
import { cn } from "@/lib/utils"

interface TermProps {
  term: GlossaryTerm
  /** The words as they read in the sentence. */
  children: ReactNode
  /** The unstaking period in seconds, read from the staking contract, for the terms that name it. */
  unstakingPeriod?: bigint | number
  className?: string
}

/**
 * A term in running text, explained where it appears. Hover or keyboard focus opens the
 * explanation, as a tooltip does. A tap opens and closes it too, because a tooltip alone never
 * opens on a touch screen. Escape closes it. The trigger is a button, so it is reachable by
 * keyboard and announced with its explanation.
 */
export function Term({ term, children, unstakingPeriod, className }: TermProps) {
  useTranslation()
  const [open, setOpen] = useState(false)
  // Whether it was open when the pointer went down. On a touch screen the browser focuses the
  // button after the finger lifts, which opens the tooltip before the click arrives; a click that
  // toggled the current state would close it at once.
  const openAtPointerDown = useRef<boolean | null>(null)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            "cursor-help underline decoration-dotted decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            className,
          )}
          onPointerDown={() => {
            openAtPointerDown.current = open
          }}
          onClick={(event) => {
            // Radix closes a tooltip on click. Toggle instead, so a tap opens it. A keyboard click
            // has no pointer down before it, and toggles what is shown.
            event.preventDefault()
            const wasOpen = openAtPointerDown.current ?? open
            openAtPointerDown.current = null
            setOpen(!wasOpen)
          }}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">{definition(term, unstakingPeriod)}</TooltipContent>
    </Tooltip>
  )
}
