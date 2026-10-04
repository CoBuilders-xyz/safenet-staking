/**
 * Builders for the Gnosis events. Parameter names and order follow packages/core/src/abis.ts,
 * which pnpm verify:abis re-derives against live chain logs.
 */
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as"
import { SignShared, SignCompleted } from "../generated/FROSTCoordinator/FROSTCoordinator"
import { TransactionProposed, TransactionAttested, EpochRolledOver } from "../generated/Consensus/Consensus"

function at<T extends ethereum.Event>(e: T, block: i32, ts: i32, logIndex: i32): T {
  e.block.number = BigInt.fromI32(block)
  e.block.timestamp = BigInt.fromI32(ts)
  e.logIndex = BigInt.fromI32(logIndex)
  return e
}

/** A point, matching Secp256k1.Point in the contract: (uint256 x, uint256 y). */
function point(): ethereum.Tuple {
  const t = new ethereum.Tuple(2)
  t[0] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))
  t[1] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(2))
  return t
}

/** FROST.Signature: ((uint256 x, uint256 y) r, uint256 z). */
function signature(): ethereum.Tuple {
  const t = new ethereum.Tuple(2)
  t[0] = ethereum.Value.fromTuple(point())
  t[1] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(3))
  return t
}

export function signShared(
  sid: string, root: string, participant: string, block: i32, ts: i32, logIndex: i32 = 0,
): SignShared {
  const e = changetype<SignShared>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("sid", ethereum.Value.fromFixedBytes(Bytes.fromHexString(sid))))
  e.parameters.push(new ethereum.EventParam("selectionRoot", ethereum.Value.fromFixedBytes(Bytes.fromHexString(root))))
  e.parameters.push(new ethereum.EventParam("participant", ethereum.Value.fromAddress(Address.fromString(participant))))
  e.parameters.push(new ethereum.EventParam("z", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(7))))
  return at(e, block, ts, logIndex)
}

export function signCompleted(
  sid: string, root: string, block: i32, ts: i32, logIndex: i32 = 0,
): SignCompleted {
  const e = changetype<SignCompleted>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("sid", ethereum.Value.fromFixedBytes(Bytes.fromHexString(sid))))
  e.parameters.push(new ethereum.EventParam("selectionRoot", ethereum.Value.fromFixedBytes(Bytes.fromHexString(root))))
  e.parameters.push(new ethereum.EventParam("signature", ethereum.Value.fromTuple(signature())))
  return at(e, block, ts, logIndex)
}

export function transactionProposed(
  safeTxHash: string, chainId: i32, safe: string, block: i32, ts: i32, logIndex: i32 = 0,
): TransactionProposed {
  const e = changetype<TransactionProposed>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("safeTxHash", ethereum.Value.fromFixedBytes(Bytes.fromHexString(safeTxHash))))
  e.parameters.push(new ethereum.EventParam("chainId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(chainId))))
  e.parameters.push(new ethereum.EventParam("safe", ethereum.Value.fromAddress(Address.fromString(safe))))
  e.parameters.push(new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))))
  const tx = new ethereum.Tuple(12)
  tx[0] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(chainId))
  tx[1] = ethereum.Value.fromAddress(Address.fromString(safe))
  tx[2] = ethereum.Value.fromAddress(Address.fromString(safe))
  tx[3] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  tx[4] = ethereum.Value.fromBytes(Bytes.empty())
  tx[5] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  tx[6] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  tx[7] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  tx[8] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  tx[9] = ethereum.Value.fromAddress(Address.zero())
  tx[10] = ethereum.Value.fromAddress(Address.zero())
  tx[11] = ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(0))
  e.parameters.push(new ethereum.EventParam("transaction", ethereum.Value.fromTuple(tx)))
  return at(e, block, ts, logIndex)
}

export function transactionAttested(
  safeTxHash: string, chainId: i32, safe: string, signatureId: string, block: i32, ts: i32, logIndex: i32 = 0,
): TransactionAttested {
  const e = changetype<TransactionAttested>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("safeTxHash", ethereum.Value.fromFixedBytes(Bytes.fromHexString(safeTxHash))))
  e.parameters.push(new ethereum.EventParam("chainId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(chainId))))
  e.parameters.push(new ethereum.EventParam("safe", ethereum.Value.fromAddress(Address.fromString(safe))))
  e.parameters.push(new ethereum.EventParam("epoch", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1))))
  e.parameters.push(new ethereum.EventParam("signatureId", ethereum.Value.fromFixedBytes(Bytes.fromHexString(signatureId))))
  e.parameters.push(new ethereum.EventParam("attestation", ethereum.Value.fromTuple(signature())))
  return at(e, block, ts, logIndex)
}

export function epochRolledOver(epoch: i32, block: i32, ts: i32, logIndex: i32 = 0): EpochRolledOver {
  const e = changetype<EpochRolledOver>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("newActiveEpoch", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(epoch))))
  return at(e, block, ts, logIndex)
}
