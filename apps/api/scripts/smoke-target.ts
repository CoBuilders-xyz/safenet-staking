interface Candidate { address: string; is_active: boolean }

// SEF activity does not establish Mainnet indexing or current-programme signing.
export async function selectSmokeTarget<T extends Candidate>(rows: T[], base: string, fetcher: typeof fetch = fetch): Promise<T> {
  const fallback = rows.find(v => v.is_active) ?? rows[0]
  if (!fallback) throw new Error("The validator list is empty.")
  for (const candidate of [fallback, ...rows.filter(v => v !== fallback)]) {
    let eligible = true
    for (const suffix of ["", "/history?window=7d"]) {
      const response = await fetcher(new URL(`/v1/validators/${candidate.address}${suffix}`, base))
      await response.arrayBuffer()
      if (response.status !== 200) { eligible = false; break }
    }
    if (eligible) return candidate
  }
  // Retain the existing smoke failure when no fully indexed validator is available.
  return fallback
}
