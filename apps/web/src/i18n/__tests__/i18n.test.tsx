import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MemoryRouter } from "react-router-dom"
import { AEGIS_START_DAY, BETA_END_DAY, REWARD_PARTICIPATION_THRESHOLD, utcDayMs } from "@cobuilders/safenet-core"
import { Header } from "@/components/layout/Header"
import { TooltipProvider } from "@/components/ui/tooltip"
import { BetaEndedNotice } from "@/components/overview/OverviewSections"
import { Validators } from "@/components/overview/Validators"
import { formatTokenAmount, formatUtcDateTime, formatUtcDayLong } from "@/lib/format"
import { BETA_ENDED_NOTICE, PARTICIPATION_RULE, RATE_NOT_PUBLISHED, WITHDRAWN_STATUS } from "@/lib/programme"
import { chooseLanguage, currentLanguage, i18n, startingLanguage } from "@/i18n"
import { LANGUAGES, LANGUAGE_STORAGE_KEY } from "@/i18n/languages"

vi.mock("@/hooks/useDarkMode", () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }))
vi.mock("@/components/wallet/ConnectButton", () => ({ ConnectButton: () => <button>Connect Wallet</button> }))

const catalogue = async (code: string) => (await import(`../locales/${code}.json`)).default

afterEach(() => {
  vi.restoreAllMocks()
})

describe("the language switcher", () => {
  const renderHeader = () =>
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )

  it("lists every language by its own name, with its lang attribute, and shows the current one", () => {
    renderHeader()
    const select = screen.getByRole("combobox", { name: "Language" })
    const options = screen.getAllByRole("option")
    expect(options.map((o) => o.textContent)).toEqual(LANGUAGES.map((l) => l.name))
    expect(options.map((o) => o.getAttribute("lang"))).toEqual(LANGUAGES.map((l) => l.code))
    expect(select).toHaveValue("en")
  })

  it("switches the copy, the lang attribute and the stored choice", async () => {
    renderHeader()
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Language" }), "de")
    expect(await screen.findByRole("link", { name: "Übersicht" })).toHaveAttribute("href", "/")
    expect(screen.getByRole("combobox", { name: "Sprache" })).toHaveValue("de")
    expect(document.documentElement.lang).toBe("de")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de")
  })
})

describe("the lang attribute and the current language", () => {
  it("follows every language change, Chinese included", async () => {
    for (const { code } of LANGUAGES) {
      await i18n.changeLanguage(code)
      expect(document.documentElement.lang).toBe(code)
      expect(currentLanguage()).toBe(code)
    }
  })

  it("stays English when a catalogue fails to load", async () => {
    i18n.removeResourceBundle("fr", "translation")
    vi.doMock("../locales/fr.json", () => {
      throw new Error("gateway timeout")
    })
    vi.resetModules()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    try {
      await i18n.changeLanguage("fr")
      expect(currentLanguage()).toBe("en")
      expect(document.documentElement.lang).toBe("en")
      expect(i18n.t("header.nav.overview")).toBe("Overview")
    } finally {
      vi.doUnmock("../locales/fr.json")
      vi.resetModules()
      i18n.addResourceBundle("fr", "translation", await catalogue("fr"))
    }
  })
})

describe("persistence and detection", () => {
  it("stores a chosen language", async () => {
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
    await chooseLanguage("ru")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("ru")
    expect(startingLanguage()).toBe("ru")
  })

  it("detects the browser's language on a first visit, and stores nothing", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["fr-CA", "en"])
    expect(startingLanguage()).toBe("fr")
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBeNull()
  })

  it("starts in the stored choice on a later visit, whatever the browser says", () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "zh-Hans")
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["de-DE"])
    expect(startingLanguage()).toBe("zh-Hans")
  })

  it("starts in English when nothing is stored and no preferred language ships", () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP", "zh-TW"])
    expect(startingLanguage()).toBe("en")
  })

  it("starts in the detected language when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["it-IT"])
    expect(startingLanguage()).toBe("it")
  })

  it("keeps the choice for the page when storage throws", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    await chooseLanguage("pt")
    expect(currentLanguage()).toBe("pt")
  })
})

describe("the English catalogue against the constants other screens still use", () => {
  // lib/programme.ts keeps these in English for the screens not yet translated. Until they move
  // to the catalogue, the two must say the same.
  it("says what lib/programme.ts says", () => {
    expect(i18n.t("programme.participationRule", { threshold: REWARD_PARTICIPATION_THRESHOLD * 100 })).toBe(PARTICIPATION_RULE)
    expect(i18n.t("programme.rateNotPublished")).toBe(RATE_NOT_PUBLISHED)
    expect(i18n.t("programme.withdrawnStatus")).toBe(WITHDRAWN_STATUS)
    expect(
      i18n.t("programme.betaEnded", {
        betaEnd: formatUtcDayLong(utcDayMs(BETA_END_DAY)),
        aegisStart: formatUtcDayLong(utcDayMs(AEGIS_START_DAY)),
      }),
    ).toBe(BETA_ENDED_NOTICE)
  })
})

describe("amounts and dates in every language", () => {
  const amount = 1_234_567_890_123_456_789_012_345n
  const iso = "2026-09-22T00:05:00.000Z"
  const row = {
    address: "0x0000000000000000000000000000000000000001" as const,
    label: "Validator One",
    stake: amount,
    share: 0.4567,
    stakers: 12_345,
    participation: 0.9876,
    participationSource: "subgraph" as const,
    absences: 1_234n,
    status: "active" as const,
  }

  it.each(LANGUAGES.map((l) => l.code))("%s keeps the English formatters", async (code) => {
    await i18n.changeLanguage(code)
    expect(formatTokenAmount(amount, 18, 0)).toBe("1,234,567")
    expect(formatTokenAmount(amount, 18, 4)).toBe("1,234,567.8901")
    expect(formatUtcDateTime(iso)).toBe("Tue 22 Sep 2026, 00:05 UTC")
    expect(formatUtcDayLong(Date.parse(iso))).toBe("22 September 2026")

    render(
      <MemoryRouter>
        <TooltipProvider>
          <Validators rows={[row]} />
          <BetaEndedNotice />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText("1,234,567")).toBeInTheDocument()
    expect(screen.getByText("45.7%")).toBeInTheDocument()
    expect(screen.getByText("12,345")).toBeInTheDocument()
    expect(screen.getByText(/1,234/, { selector: "div" })).toBeInTheDocument()
    const notice = screen.getByRole("note")
    expect(notice).toHaveTextContent(formatUtcDayLong(utcDayMs(BETA_END_DAY)))
    expect(notice).toHaveTextContent(formatUtcDayLong(utcDayMs(AEGIS_START_DAY)))
    const strings = await catalogue(code)
    expect(screen.getByRole("columnheader", { name: strings.overview.validators.column.staked })).toBeInTheDocument()
  })
})

describe("every catalogue", () => {
  it.each(LANGUAGES.map((l) => l.code))("%s renders the header in its own words", async (code) => {
    await i18n.changeLanguage(code)
    const strings = await catalogue(code)
    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByRole("link", { name: strings.header.nav.overview })[0]).toBeInTheDocument())
    expect(screen.getByRole("combobox", { name: strings.header.language })).toHaveValue(code)
  })
})
