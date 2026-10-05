/**
 * Builders for the events the handlers receive.
 *
 * The parameter names and order match packages/core/src/abis.ts, which pnpm verify:abis
 * re-derives against live chain logs. A test that invents a different shape would pass while
 * the real subgraph indexed nothing, so these are the one place the shape is written here.
 */
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts"
import { newMockEvent } from "matchstick-as"
import {
  StakeIncreased,
  WithdrawalInitiated,
  WithdrawalClaimed,
  ValidatorUpdated,
} from "../generated/Staking/Staking"
import { Claimed, MerkelRootUpdated } from "../generated/MerkleDrop/MerkleDrop"

function at<T extends ethereum.Event>(e: T, block: i32, ts: i32, logIndex: i32): T {
  e.block.number = BigInt.fromI32(block)
  e.block.timestamp = BigInt.fromI32(ts)
  e.logIndex = BigInt.fromI32(logIndex)
  return e
}

export function stakeIncreased(
  staker: string, validator: string, amount: string, block: i32, ts: i32, logIndex: i32 = 0,
): StakeIncreased {
  const e = changetype<StakeIncreased>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("staker", ethereum.Value.fromAddress(Address.fromString(staker))))
  e.parameters.push(new ethereum.EventParam("validator", ethereum.Value.fromAddress(Address.fromString(validator))))
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))))
  return at(e, block, ts, logIndex)
}

export function withdrawalInitiated(
  staker: string, validator: string, withdrawalId: i32, amount: string, block: i32, ts: i32, logIndex: i32 = 0,
): WithdrawalInitiated {
  const e = changetype<WithdrawalInitiated>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("staker", ethereum.Value.fromAddress(Address.fromString(staker))))
  e.parameters.push(new ethereum.EventParam("validator", ethereum.Value.fromAddress(Address.fromString(validator))))
  e.parameters.push(new ethereum.EventParam("withdrawalId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(withdrawalId))))
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))))
  return at(e, block, ts, logIndex)
}

export function withdrawalClaimed(
  staker: string, withdrawalId: i32, amount: string, block: i32, ts: i32, logIndex: i32 = 0,
): WithdrawalClaimed {
  const e = changetype<WithdrawalClaimed>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("staker", ethereum.Value.fromAddress(Address.fromString(staker))))
  e.parameters.push(new ethereum.EventParam("withdrawalId", ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(withdrawalId))))
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))))
  return at(e, block, ts, logIndex)
}

export function validatorUpdated(
  validator: string, isRegistered: boolean, block: i32, ts: i32, logIndex: i32 = 0,
): ValidatorUpdated {
  const e = changetype<ValidatorUpdated>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("validator", ethereum.Value.fromAddress(Address.fromString(validator))))
  e.parameters.push(new ethereum.EventParam("isRegistered", ethereum.Value.fromBoolean(isRegistered)))
  return at(e, block, ts, logIndex)
}

export function claimed(
  account: string, amount: string, block: i32, ts: i32, logIndex: i32 = 0,
): Claimed {
  const e = changetype<Claimed>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("account", ethereum.Value.fromAddress(Address.fromString(account))))
  e.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(BigInt.fromString(amount))))
  return at(e, block, ts, logIndex)
}

/** Neither parameter is indexed, and the order is (old, new). Both read from real logs. */
export function merkelRootUpdated(
  oldRoot: string, newRoot: string, block: i32, ts: i32, logIndex: i32 = 0,
): MerkelRootUpdated {
  const e = changetype<MerkelRootUpdated>(newMockEvent())
  e.parameters = new Array()
  e.parameters.push(new ethereum.EventParam("oldRoot", ethereum.Value.fromFixedBytes(Bytes.fromHexString(oldRoot))))
  e.parameters.push(new ethereum.EventParam("newRoot", ethereum.Value.fromFixedBytes(Bytes.fromHexString(newRoot))))
  return at(e, block, ts, logIndex)
}
