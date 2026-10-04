import { activeChain } from "@/config/chains"

const explorer = activeChain.blockExplorers?.default

/** Name of the active chain's block explorer, e.g. "Etherscan". */
export const explorerName: string | undefined = explorer?.name

/** Explorer page for an address on the active chain, or undefined when the chain has none. */
export function explorerAddressUrl(address: string): string | undefined {
  return explorer ? `${explorer.url}/address/${address}` : undefined
}
