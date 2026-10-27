import { cn } from "@/lib/utils"

/**
 * A placeholder while a value loads. Without a label it is decoration. With one it is announced
 * as a status, because ARIA does not allow a label on an element that has no role.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  const labelled = props["aria-label"] !== undefined
  return (
    <div
      role={labelled ? "status" : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn("animate-pulse motion-reduce:animate-none rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
