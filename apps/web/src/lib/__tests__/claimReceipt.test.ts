import { describe, it, expect } from "vitest"
import { encodeAbiParameters, encodeEventTopics, type Address, type Hex, type Log } from "viem"
import { merkleDropAbi, safeTokenEventsAbi } from "@cobuilders/safenet-core"
import { getContractAddresses } from "@/config/contracts"
import { activeChain } from "@/config/chains"
import { TEST_ACCOUNTS } from "@/__tests__/test-data"
import { claimedAmountFromLogs } from "../claimReceipt"

const SAFE = 10n ** 18n
const { token, merkleDrop } = getContractAddresses(activeChain.id)
const account = TEST_ACCOUNTS.user
const other = TEST_ACCOUNTS.validator1

function log(address: Address, topics: Hex[], data: Hex): Log {
  return {
    address,
    topics: topics as Log["topics"],
    data,
    blockHash: null,
    blockNumber: null,
    logIndex: null,
    transactionHash: null,
    transactionIndex: null,
    removed: false,
  }
}

function transfer(from: Address, to: Address, value: bigint, tokenAddress: Address = token): Log {
  const topics = encodeEventTopics({ abi: safeTokenEventsAbi, eventName: "Transfer", args: { from, to } })
  return log(tokenAddress, topics as Hex[], encodeAbiParameters([{ type: "uint256" }], [value]))
}

function claimed(value: bigint): Log {
  const topics = encodeEventTopics({ abi: merkleDropAbi, eventName: "Claimed", args: { account } })
  return log(merkleDrop!, topics as Hex[], encodeAbiParameters([{ type: "uint256" }], [value]))
}

const where = { token, merkleDrop: merkleDrop!, account }

describe("claimedAmountFromLogs", () => {
  it("reads the SAFE transfer from the MerkleDrop to the account", () => {
    expect(claimedAmountFromLogs([claimed(42n * SAFE), transfer(merkleDrop!, account, 42n * SAFE)], where)).toBe(
      42n * SAFE,
    )
  })

  it("ignores transfers that are not the payout", () => {
    const logs = [
      transfer(other, account, 1n * SAFE),
      transfer(merkleDrop!, other, 2n * SAFE),
      transfer(merkleDrop!, account, 3n * SAFE, other),
      transfer(merkleDrop!, account, 7n * SAFE),
    ]
    expect(claimedAmountFromLogs(logs, where)).toBe(7n * SAFE)
  })

  it("matches addresses whatever their case", () => {
    const logs = [transfer(merkleDrop!, account, 5n * SAFE)]
    expect(
      claimedAmountFromLogs(logs, {
        token: token.toLowerCase() as Address,
        merkleDrop: merkleDrop!.toUpperCase().replace("0X", "0x") as Address,
        account,
      }),
    ).toBe(5n * SAFE)
  })

  it("is undefined, not zero, when the receipt has no payout", () => {
    expect(claimedAmountFromLogs([], where)).toBeUndefined()
    expect(claimedAmountFromLogs([claimed(1n)], where)).toBeUndefined()
  })
})
