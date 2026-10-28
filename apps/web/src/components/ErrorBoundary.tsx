import { Component, type ErrorInfo, type ReactNode } from "react"
import { PageError } from "@/components/PageError"

interface ErrorBoundaryProps {
  children: ReactNode
  /**
   * Rendered instead of the page-level message, for a boundary around one section, so a
   * section that throws leaves the rest of the page standing. Receives the retry handler.
   */
  fallback?: (retry: () => void) => ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Catches rendering errors in child components and displays
 * a fallback UI with a retry button instead of a blank screen.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary caught an error:", error, info)
  }

  handleRetry = () => {
    this.setState({ hasError: false })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback(this.handleRetry)
      return <PageError onRetry={this.handleRetry} />
    }

    return this.props.children
  }
}
