/**
 * The staking flows against the real contracts, on Anvil forked from Mainnet at a pinned block.
 *
 * Each test drives the interface, then reads the chain to prove the transaction did what the
 * screen says. A green screen over an unchanged chain fails here.
 */
import { getAddress, parseEther } from "viem"
import { MAINNET_FORK } from "@cobuilders/safenet-core"
import { test, expect, syncBrowserClock } from "./fork.fixture"
import { ValidatorDetailPage } from "../pages/validator-detail.page"
import { WithdrawalsPage } from "../pages/withdrawals.page"
import { presetAmount } from "../../src/lib/format"
import {
  MERKLE_DROP,
  STAKING,
  activeValidator,
  allowance,
  chain,
  findRewardsClaimer,
  fundSafe,
  impersonate,
  merkleDropAbi,
  pendingWithdrawals,
  safeBalance,
  send,
  stakeDirectly,
  stakeOf,
  stakingAbi,
  stopImpersonating,
  warp,
} from "./chain"

test.describe("Mainnet fork", () => {
  test("approve, then stake to a validator", async ({ page, user, connectAs }) => {
    const validator = getAddress((await activeValidator()).address)
    const amount = parseEther("100")
    await fundSafe(user, amount)

    const balanceBefore = await safeBalance(user)
    const stakeBefore = await stakeOf(user, validator)
    const validatorTotalBefore = await chain.readContract({
      address: STAKING,
      abi: stakingAbi,
      functionName: "totalValidatorStakes",
      args: [validator],
    })

    await connectAs(user)
    const detail = new ValidatorDetailPage(page)
    await detail.goto(validator)
    await detail.delegateButton.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Stake SAFE" })).toBeVisible()
    await dialog.getByLabel("Amount").fill("100")

    await dialog.getByRole("button", { name: "Approve exact amount" }).click()
    await expect(page.getByText("Approval confirmed")).toBeVisible()
    expect(await allowance(user)).toBe(amount)

    const stakeButton = dialog.getByRole("button", { name: "Stake", exact: true })
    await expect(stakeButton).toBeEnabled()
    await stakeButton.click()
    await expect(page.getByText("Delegation successful")).toBeVisible()

    expect(await stakeOf(user, validator)).toBe(stakeBefore + amount)
    expect(await safeBalance(user)).toBe(balanceBefore - amount)
    expect(await allowance(user)).toBe(0n)
    expect(
      await chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "totalValidatorStakes", args: [validator] }),
    ).toBe(validatorTotalBefore + amount)
  })

  test("initiate a withdrawal", async ({ page, user, connectAs }) => {
    const validator = getAddress((await activeValidator()).address)
    const staked = parseEther("100")
    const withdrawn = parseEther("40")
    await fundSafe(user, staked)
    await stakeDirectly(user, validator, staked)
    const delay = await chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "withdrawDelay" })

    await connectAs(user)
    const detail = new ValidatorDetailPage(page)
    await detail.goto(validator)
    await detail.undelegateButton.click()

    const dialog = page.getByRole("dialog")
    await expect(dialog.getByRole("heading", { name: "Unstake SAFE" })).toBeVisible()
    await dialog.getByLabel("Unstake Amount").fill("40")
    await dialog.getByRole("button", { name: "Initiate Withdrawal" }).click()
    await expect(page.getByText("Unstaking initiated")).toBeVisible()

    expect(await stakeOf(user, validator)).toBe(staked - withdrawn)

    // One pending withdrawal, claimable exactly withdrawDelay after the block that queued it.
    const [initiated] = await chain.getContractEvents({
      address: STAKING,
      abi: stakingAbi,
      eventName: "WithdrawalInitiated",
      args: { staker: user },
      // After the fork only: earlier blocks would be fetched from the archive node.
      fromBlock: MAINNET_FORK.blockNumber + 1n,
    })
    expect(initiated?.args.amount).toBe(withdrawn)
    expect(initiated?.args.validator).toBe(validator)
    const queuedAt = (await chain.getBlock({ blockNumber: initiated!.blockNumber })).timestamp
    expect(await pendingWithdrawals(user)).toEqual([{ amount: withdrawn, claimableAt: queuedAt + delay }])
  })

  test("claim a withdrawal once the cooldown has passed", async ({ page, user, connectAs }) => {
    const validator = getAddress((await activeValidator()).address)
    const amount = parseEther("25")
    await fundSafe(user, amount)
    await stakeDirectly(user, validator, amount)
    await send(user, { address: STAKING, abi: stakingAbi, functionName: "initiateWithdrawal", args: [validator, amount] })

    const delay = await chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "withdrawDelay" })
    const pendingTotalBefore = await chain.readContract({
      address: STAKING,
      abi: stakingAbi,
      functionName: "totalPendingWithdrawals",
    })

    // Before the cooldown: queued, not claimable.
    await connectAs(user)
    const withdrawals = new WithdrawalsPage(page)
    await withdrawals.goto()
    await expect(withdrawals.pendingHeading).toBeVisible()
    await expect(page.getByText("Cooldown progress")).toBeVisible()
    await expect(withdrawals.claimButton).toHaveCount(0)

    await warp(delay + 1n)
    await syncBrowserClock(page)
    await page.reload()

    await expect(withdrawals.readyToClaim).toBeVisible()
    await withdrawals.claimButton.click()
    await expect(page.getByText("Withdrawal claimed")).toBeVisible()

    expect(await safeBalance(user)).toBe(amount)
    expect(await pendingWithdrawals(user)).toEqual([])
    expect(
      await chain.readContract({ address: STAKING, abi: stakingAbi, functionName: "totalPendingWithdrawals" }),
    ).toBe(pendingTotalBefore - amount)
    await expect(withdrawals.noPendingMessage).toBeVisible()
  })

  test("claim rewards with SEF's real proof", async ({ page, connectAs }) => {
    const { account, proof, claimable } = await findRewardsClaimer()
    await impersonate(account)
    try {
      const balanceBefore = await safeBalance(account)
      const dropBefore = await safeBalance(MERKLE_DROP)

      await connectAs(account)
      await page.goto("/#/rewards")
      const actions = page.getByRole("region", { name: "Actions" })
      const claim = actions.getByRole("button", { name: "Claim", exact: true })
      await expect(claim).toBeEnabled()
      await claim.click()

      const dialogClaim = page.getByRole("dialog").getByRole("button", { name: "Claim Rewards" })
      await expect(dialogClaim).toBeEnabled()
      await dialogClaim.click()
      await expect(page.getByText("Rewards claimed")).toBeVisible()

      expect(
        await chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [account] }),
      ).toBe(BigInt(proof.cumulativeAmount))
      expect(await safeBalance(account)).toBe(balanceBefore + claimable)
      expect(await safeBalance(MERKLE_DROP)).toBe(dropBefore - claimable)
      await expect(actions.getByText("Nothing to claim right now.")).toBeVisible()
    } finally {
      // Even on a failed assertion, so the account is not left impersonated for later tests.
      await stopImpersonating(account)
    }
  })

  test("claim rewards and stake them in one flow", async ({ page, connectAs }) => {
    const { account, proof, claimable } = await findRewardsClaimer()
    const validator = getAddress((await activeValidator()).address)
    await impersonate(account)
    try {
      const balanceBefore = await safeBalance(account)
      const stakeBefore = await stakeOf(account, validator)

      await connectAs(account)
      await page.goto("/#/rewards")
      const actions = page.getByRole("region", { name: "Actions" })
      await actions.getByRole("button", { name: "Claim & Stake" }).click()

      const dialog = page.getByRole("dialog")
      await dialog.getByRole("button", { name: /^Claim .* SAFE$/ }).click()
      await expect(page.getByText("Rewards claimed")).toBeVisible()
      expect(
        await chain.readContract({ address: MERKLE_DROP, abi: merkleDropAbi, functionName: "cumulativeClaimed", args: [account] }),
      ).toBe(BigInt(proof.cumulativeAmount))

      // The amount the claim paid, shown as SAFE rounded down, never as a wei-precise string.
      const amount = dialog.getByLabel("Amount")
      await expect(amount).toHaveValue(presetAmount(claimable).text)
      await dialog.getByLabel("Validator").selectOption(validator)

      // A real claimer's allowance does not cover the amount, and this wallet cannot batch.
      if ((await allowance(account)) < claimable) {
        await dialog.getByRole("button", { name: "Approve exact amount" }).click()
        await expect(page.getByText("Approval confirmed")).toBeVisible()
        expect(await allowance(account)).toBe(claimable)
      }
      const stakeButton = dialog.getByRole("button", { name: "Stake", exact: true })
      await expect(stakeButton).toBeEnabled()
      await stakeButton.click()
      await expect(dialog.getByRole("status")).toContainText("Staked")

      // Every wei of the claim is staked, though the input showed it rounded.
      expect(await stakeOf(account, validator)).toBe(stakeBefore + claimable)
      expect(await safeBalance(account)).toBe(balanceBefore)
    } finally {
      await stopImpersonating(account)
    }
  })
})
