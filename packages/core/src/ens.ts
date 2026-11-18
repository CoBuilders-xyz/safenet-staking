/**
 * The ENS name of the interface, and where its contenthash lives. The web release
 * (.github/workflows/release.yml) points the name at each new release CID.
 *
 * The release writes to the resolver the ENS registry names for the name itself, not the one the
 * Universal Resolver finds. On 2026-11-18 they differed for safenet.cobuilders.eth: the Universal
 * Resolver named the resolver of a parent, and eth.limo served the contenthash of the registry's.
 */

/** The ENS name that serves the web release, through eth.limo. */
export const WEB_ENS_NAME = "safenet.cobuilders.eth"

/** The ENS registry on Mainnet. */
export const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const
