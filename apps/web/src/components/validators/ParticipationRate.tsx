import { REWARD_PARTICIPATION_THRESHOLD } from "@cobuilders/safenet-core"
import { useTranslation } from "react-i18next"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { THRESHOLD_LABEL, belowThreshold } from "@/lib/programme"
import { cn } from "@/lib/utils"

interface ParticipationRateProps {
  /** Ceremonies attended, as a fraction. */
  rate: number
  /** The rate as the caller formats it. Two decimals by default. */
  text?: string
  className?: string
}

/**
 * A participation rate with the reward threshold beside it: a marker that reads "≥75%" or
 * "<75%", and SEF's rule in its tooltip. Every screen that shows a rate uses this, so the
 * threshold reads the same everywhere. A rate below the threshold is also coloured, never
 * coloured alone.
 */
export function ParticipationRate({ rate, text, className }: ParticipationRateProps) {
  const { t } = useTranslation()
  const below = belowThreshold(rate)
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn(below && "text-warning")}>{text ?? `${(rate * 100).toFixed(2)}%`}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={below ? t("validators.belowThreshold", "Below the {{threshold}} reward threshold", { threshold: THRESHOLD_LABEL }) : t("validators.aboveThreshold", "At or above the {{threshold}} reward threshold", { threshold: THRESHOLD_LABEL })}
            className={cn(
              "inline-flex items-center rounded-sm border px-1 font-mono text-[10px] normal-case leading-4 tracking-normal",
              below ? "border-warning/50 bg-warning/10 text-warning" : "border-border text-faint hover:text-muted-foreground",
            )}
          >
            {below ? "<" : "≥"}
            {THRESHOLD_LABEL}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs normal-case">
          <p>{t("programme.participationRule", "If a validator's participation is below {{threshold}}% in a reward period, both the validator and its delegators earn no rewards for that period.", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

/**
 * SEF's published rate, in percent as `useValidators` gives it. SEF's file can list a validator
 * with no rate; that reads "Not published", with no threshold marker, and never as 0.00%.
 */
export function PublishedParticipationRate({ percent, className }: { percent: number | null; className?: string }) {
  const { t } = useTranslation()
  if (percent === null) return <span className={cn("text-muted-foreground", className)}>{t("programme.rateNotPublished", "Not published")}</span>
  return <ParticipationRate className={className} rate={percent / 100} text={`${percent}%`} />
}
