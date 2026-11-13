/**
 * The version of the Terms of use that a visitor accepts before connecting a wallet. It is the
 * date of the "Last updated" line of `src/content/en/terms.md`; a test holds the two together.
 * Change both with every change to the terms: every visitor is then asked to accept again.
 *
 * No `import.meta.env` here: the e2e fixtures import this file under Node.
 */
export const TERMS_VERSION = "2026-11-13"

/** Where `localStorage` keeps the accepted version and the time of acceptance. */
export const TERMS_ACCEPTANCE_STORAGE_KEY = "terms_accepted"
