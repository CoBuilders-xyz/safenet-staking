import { Outlet } from "react-router-dom"
import { TooltipProvider } from "@/components/ui/tooltip"

/** Renders with the routed content after access checks; the header needs no tooltip provider. */
export default function RouteContent() {
  return (
    <TooltipProvider delayDuration={100}>
      <Outlet />
    </TooltipProvider>
  )
}
