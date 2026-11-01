import type { TFunction } from "i18next"
import { useQueries } from "@tanstack/react-query"
import { useConfig } from "wagmi"
import { getEnsName } from "wagmi/actions"
import type { Address } from "viem"
import { activeChain } from "@/config/chains"

/** What ENS answered for one address. */
export type EnsLookup =
  | { status: "loading" }
  | { status: "found"; name: string }
  | { status: "none" }
  | { status: "failed" }

/** A primary name changes rarely; an hour keeps the list from asking again on every visit. */
const ENS_STALE_MS = 60 * 60 * 1000

/**
 * The ENS primary name of each address, by reverse resolution through the Universal Resolver on
 * Mainnet. The Universal Resolver checks that the name resolves forward to the same address, so a
 * reverse record naming someone else's name is not shown. Keyed by lowercase address.
 */
export function useEnsNames(addresses: readonly Address[]): Map<string, EnsLookup> {
  const config = useConfig()
  const results = useQueries({
    queries: addresses.map((address) => ({
      queryKey: ["ensName", activeChain.id, address.toLowerCase()],
      queryFn: () => getEnsName(config, { address, chainId: activeChain.id }),
      staleTime: ENS_STALE_MS,
      gcTime: ENS_STALE_MS,
      retry: false,
    })),
  })
  return new Map(
    addresses.map((address, i): [string, EnsLookup] => {
      const r = results[i]
      const lookup: EnsLookup = r.error
        ? { status: "failed" }
        : r.data === undefined
          ? { status: "loading" }
          : r.data
            ? { status: "found", name: r.data }
            : { status: "none" }
      return [address.toLowerCase(), lookup]
    }),
  )
}

export type NameSource = "ens" | "sef" | "address"

/** The name to show: the ENS primary name, otherwise SEF's label, otherwise none. */
export function displayName(lookup: EnsLookup | undefined, sefLabel: string | undefined): { name: string | undefined; source: NameSource } {
  if (lookup?.status === "found") return { name: lookup.name, source: "ens" }
  if (sefLabel) return { name: sefLabel, source: "sef" }
  return { name: undefined, source: "address" }
}

/** The caption sentence naming where the names on a screen come from: one validator's, or a list's. */
export function nameSourceCaption(lookups: readonly (EnsLookup | undefined)[], t: TFunction): string {
  const known = lookups.filter((l): l is EnsLookup => l !== undefined)
  if (known.some((l) => l.status === "found")) return t("selector.namesEns", "Names: ENS primary names, verified by reverse resolution; SEF labels where no name is set.")
  if (known.some((l) => l.status === "loading")) return t("selector.namesLoading", "Names: SEF labels while ENS is read.")
  if (known.some((l) => l.status === "failed")) return t("selector.namesFailed", "Names: SEF labels. ENS could not be read.")
  return t("selector.namesNone", "Names: SEF labels. No ENS primary name is set.")
}
