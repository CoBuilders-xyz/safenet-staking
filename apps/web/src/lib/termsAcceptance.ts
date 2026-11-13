import { useSyncExternalStore } from "react"
import { TERMS_ACCEPTANCE_STORAGE_KEY, TERMS_VERSION } from "@/config/terms"

/**
 * Whether this browser has accepted the current Terms of use. A wallet connects only after that.
 * The record is `{ version, acceptedAt }` in `localStorage`; a record of another version, or one
 * that cannot be read, is no acceptance, so a new version of the terms asks again.
 */
export interface TermsAcceptance {
  version: string
  /** ISO 8601, UTC. */
  acceptedAt: string
}

// Storage can be unavailable, as in a sandboxed or third-party iframe. The acceptance then lasts
// until the page closes.
let inMemory: string | null = null
const listeners = new Set<() => void>()

function read(): string | null {
  // What this page accepted comes first: a write that storage refused leaves an older record there.
  if (inMemory !== null) return inMemory
  try {
    return localStorage.getItem(TERMS_ACCEPTANCE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function hasAcceptedTerms(): boolean {
  const raw = read()
  if (!raw) return false
  try {
    const record: Partial<TermsAcceptance> | null = JSON.parse(raw)
    return record?.version === TERMS_VERSION
  } catch {
    return false
  }
}

export function acceptTerms(now: Date = new Date()): void {
  const record: TermsAcceptance = { version: TERMS_VERSION, acceptedAt: now.toISOString() }
  inMemory = JSON.stringify(record)
  try {
    localStorage.setItem(TERMS_ACCEPTANCE_STORAGE_KEY, inMemory)
  } catch {
    // Storage unavailable: kept in memory.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab accepted, or the record was cleared there.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === TERMS_ACCEPTANCE_STORAGE_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/** Follows the acceptance: every connect control updates when one of them records it. */
export function useTermsAccepted(): boolean {
  return useSyncExternalStore(subscribe, hasAcceptedTerms)
}

/** For tests: forget an acceptance kept in memory. */
export function resetTermsAcceptanceForTests(): void {
  inMemory = null
  for (const listener of listeners) listener()
}
