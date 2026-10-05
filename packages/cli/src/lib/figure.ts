/** A value and where it came from. Every number this tool reports carries its source. */
export interface Figure<T> {
  readonly value: T
  /** "chain: Contract.call()" or "SEF: file field". */
  readonly source: string
}

export const figure = <T>(value: T, source: string): Figure<T> => ({ value, source })

/** viem returns bytes32 in lower case; SEF's files may not be. */
export const sameHex = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
