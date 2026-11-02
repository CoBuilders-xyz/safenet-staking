/**
 * The compliance gates the web interface applies before a wallet can act, for every front end that
 * signs: the interface, the CLI and the MCP server.
 *
 * - The sanctions oracle on chain, CONTRACTS.sanctionsList, always: an address is allowed only when
 *   `isSanctioned(address)` answers false. `useWalletSanctionsCheck` in the web app.
 * - A sanctions endpoint, opt in: a GET to the operator's URL. It judges the client making the
 *   request, so it takes no address. 403 refuses; any other failure refuses too. `useSanctionsCheck`.
 * - A geo check, opt in: the country of the client's IP from GEO_LOOKUPS, the second only when the
 *   first fails, against GEOBLOCKED_COUNTRIES. No country refuses. `useGeoblockCheck`.
 *
 * Every gate fails closed: an answer that is not a clear yes refuses.
 *
 * `compliance.test.ts` reads the web's hook and fails when its lookups or its country list differ
 * from these.
 */

/** A service that names the country of the IP address a request comes from. */
export interface GeoLookup {
  readonly name: string
  readonly url: string
  /** `json`: a body `{ "country": "XX" }`. `text`: the two-letter code alone. */
  readonly format: "json" | "text"
}

/** In the order they are tried. */
export const GEO_LOOKUPS: readonly GeoLookup[] = [
  { name: "country.is", url: "https://api.country.is", format: "json" },
  { name: "ipapi.co", url: "https://ipapi.co/country", format: "text" },
]

/** Countries the web interface blocks, ISO 3166-1 alpha-2. */
export const GEOBLOCKED_COUNTRIES: readonly string[] = [
  "CN", "RU", "CU", "IR", "KP", "SO", "VE", "AF", "BY", "CD", "ER", "HT",
  "LB", "MM", "SD", "SY", "ZW", "IQ", "LY", "SS", "CF", "ET", "KH", "UA",
]

/** The answer a sanctions endpoint gives to a client it refuses. */
export const SANCTIONS_ENDPOINT_REFUSED_STATUS = 403
