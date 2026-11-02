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
  /** `json`: a body `{ "country": "US" }`. `text`: the two-letter code alone. */
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

/**
 * ISO 3166-1 alpha-2 assignments, plus XK (Kosovo), used by the IP lookup providers.
 * Source: https://www.iso.org/obp/ui/#search/code/ and the providers' country-code contract.
 * This validates a location, not sanctions policy. Unknown/proxy codes (XX, ZZ, T1) are not locations.
 */
const COUNTRY_CODES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK"
).split(" "))

/** Accept an assigned geographic code, never an unknown or non-country provider sentinel. */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && COUNTRY_CODES.has(value)
}
