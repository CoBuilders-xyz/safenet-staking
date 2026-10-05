/** Where a figure on the overview was read from. */
export type FigureSource = "subgraph" | "contract" | "sef" | "snapshot"

/**
 * One figure on the overview: still loading, ready with the source it came from, or unavailable
 * with a sentence saying why. A screen never shows a number without knowing which of these it is.
 */
export type Figure<T> =
  | { state: "loading" }
  | { state: "ready"; value: T; source: FigureSource }
  | { state: "unavailable"; reason: string }

export const loading = <T>(): Figure<T> => ({ state: "loading" })

export const ready = <T>(value: T, source: FigureSource): Figure<T> => ({ state: "ready", value, source })

export const unavailable = <T>(reason: string): Figure<T> => ({ state: "unavailable", reason })

/** A figure from a contract read or a fetch: loading, its value, or unavailable on error. */
export function fromRead<T>(
  read: { data: T | undefined; error: unknown },
  source: FigureSource,
  failure: string,
): Figure<T> {
  if (read.error) return unavailable(failure)
  if (read.data === undefined) return loading()
  return ready(read.data, source)
}

/** Apply `f` to a ready value; loading and unavailable pass through. */
export function mapFigure<T, U>(figure: Figure<T>, f: (value: T) => U): Figure<U> {
  return figure.state === "ready" ? ready(f(figure.value), figure.source) : figure
}
