import { describe, it, expect } from "vitest"
import { formatDuration, formatParticipation, formatTokenAmount, isRounded, parseAmount, presetAmount, truncateAddress, formatCountdown, formatUtcDateTime, formatUtcDayLong } from "../format"

describe("formatTokenAmount", () => {
  it("formats zero", () => {
    expect(formatTokenAmount(0n)).toBe("0")
  })

  it("formats a whole number (no decimals)", () => {
    expect(formatTokenAmount(1000n * 10n ** 18n)).toBe("1,000")
  })

  it("formats with decimals truncated to maxDecimals", () => {
    // 1.123456789... SAFE
    const amount = 1_123456789012345678n
    expect(formatTokenAmount(amount)).toBe("1.1234")
  })

  it("respects custom maxDecimals", () => {
    const amount = 1_123456789012345678n
    expect(formatTokenAmount(amount, 18, 2)).toBe("1.12")
  })

  it("formats with maxDecimals=0 returns whole number only", () => {
    const amount = 1_500000000000000000n
    expect(formatTokenAmount(amount, 18, 0)).toBe("1")
  })

  it("formats large numbers (>1M)", () => {
    const amount = 1_000_000n * 10n ** 18n
    expect(formatTokenAmount(amount)).toBe("1,000,000")
  })

  it("formats small decimals", () => {
    // 0.0001 SAFE
    const amount = 100000000000000n
    expect(formatTokenAmount(amount)).toBe("0.0001")
  })

  it("formats with custom decimals (e.g. 6)", () => {
    // 1.5 USDC (6 decimals)
    const amount = 1_500000n
    expect(formatTokenAmount(amount, 6, 2)).toBe("1.5")
  })
})

describe("truncateAddress", () => {
  it("truncates a standard 42-char address", () => {
    expect(truncateAddress("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234...5678")
  })

  it("lowercases checksummed addresses", () => {
    expect(truncateAddress("0xABcdEF1234567890abcdef1234567890AbCdEf12")).toBe("0xabcd...ef12")
  })

  it("handles a short string", () => {
    expect(truncateAddress("0x1234")).toBe("0x1234...1234")
  })
})

describe("formatCountdown", () => {
  it("returns 'Ready' for 0 seconds", () => {
    expect(formatCountdown(0)).toBe("Ready")
  })

  it("returns 'Ready' for negative seconds", () => {
    expect(formatCountdown(-10)).toBe("Ready")
  })

  it("formats seconds only", () => {
    expect(formatCountdown(45)).toBe("45s")
  })

  it("formats minutes and seconds", () => {
    expect(formatCountdown(125)).toBe("2m 5s")
  })

  it("formats hours, minutes, and seconds", () => {
    expect(formatCountdown(3661)).toBe("1h 1m 1s")
  })

  it("formats days, hours, and minutes", () => {
    expect(formatCountdown(90061)).toBe("1d 1h 1m")
  })

  it("formats exactly 7 days (withdrawal delay)", () => {
    expect(formatCountdown(604800)).toBe("7d 0h 0m")
  })
})

describe("formatUtcDateTime", () => {
  it("formats a period boundary in UTC", () => {
    expect(formatUtcDateTime("2026-09-22T00:00:00.000Z")).toBe("Tue 22 Sep 2026, 00:00 UTC")
  })

  it("converts an offset timestamp to UTC", () => {
    expect(formatUtcDateTime("2026-09-22T08:55:44+02:00")).toBe("Tue 22 Sep 2026, 06:55 UTC")
  })

  it("rolls over the date when the offset crosses midnight", () => {
    expect(formatUtcDateTime("2026-09-21T23:30:00-01:00")).toBe("Tue 22 Sep 2026, 00:30 UTC")
  })
})

describe("formatParticipation", () => {
  it("floors beside a missed count, so 2 missed of 59,192 reads 99.99% and not 100.00%", () => {
    // The rate as deriveConsensusWindow computes it: attended over ceremonies, at nine decimals.
    const rate = Number((59_190n * 1_000_000_000n) / 59_192n) / 1_000_000_000
    expect(formatParticipation(rate, 2n)).toBe("99.99%")
  })

  it("rounds with nothing missed, so a full record reads 100.00%", () => {
    expect(formatParticipation(1, 0n)).toBe("100.00%")
  })

  it("takes the rate at nine decimals before flooring, so 3 attended of 10,000 reads 0.03% and not 0.02%", () => {
    const rate = Number((3n * 1_000_000_000n) / 10_000n) / 1_000_000_000
    expect(formatParticipation(rate, 9_997n)).toBe("0.03%")
  })
})

describe("formatUtcDayLong", () => {
  it("writes the UTC day with the month in full", () => {
    expect(formatUtcDayLong(Date.UTC(2026, 9, 5))).toBe("5 October 2026")
  })

  it("takes the UTC day, not the local one", () => {
    expect(formatUtcDayLong(Date.UTC(2026, 9, 12, 23, 59))).toBe("12 October 2026")
  })
})

describe("presetAmount and parseAmount", () => {
  const SAFE = 10n ** 18n

  it("shows a wei-precise amount to four decimals and parses its text back to the exact value", () => {
    const value = 12n * SAFE + 345_678_901_234_567_891n
    const preset = presetAmount(value)
    expect(preset.text).toBe("12.3456")
    expect(isRounded(preset)).toBe(true)
    expect(parseAmount(preset.text, preset)).toBe(value)
  })

  it("round-trips amounts at every scale exactly", () => {
    for (const value of [1n, 999n, SAFE, SAFE + 1n, 10n ** 24n + 7n, 2n ** 128n - 1n]) {
      const preset = presetAmount(value)
      expect(parseAmount(preset.text, preset)).toBe(value)
    }
  })

  it("parses edited text as typed, not as the preset", () => {
    const preset = presetAmount(12n * SAFE + 345_678_901_234_567_891n)
    expect(parseAmount("12.3457", preset)).toBe(12_345_700_000_000_000_000n)
    expect(parseAmount("12.3456")).toBe(12_345_600_000_000_000_000n)
  })

  it("keeps whole amounts unrounded", () => {
    const preset = presetAmount(60n * SAFE)
    expect(preset.text).toBe("60")
    expect(isRounded(preset)).toBe(false)
  })

  it("keeps every decimal of an amount that four decimals would show as 0", () => {
    const preset = presetAmount(1234n)
    expect(preset.text).toBe("0.000000000000001234")
    expect(parseAmount(preset.text, preset)).toBe(1234n)
    expect(isRounded(preset)).toBe(false)
  })
})

describe("formatDuration", () => {
  it("reads a duration in words, largest units first, zero parts left out", () => {
    expect(formatDuration(172_800)).toBe("2 days")
    expect(formatDuration(604_800)).toBe("7 days")
    expect(formatDuration(86_400 + 3_600)).toBe("1 day 1 hour")
    expect(formatDuration(90 * 60 + 5)).toBe("1 hour 30 minutes 5 seconds")
    expect(formatDuration(1)).toBe("1 second")
    expect(formatDuration(0)).toBe("no time")
  })
})
