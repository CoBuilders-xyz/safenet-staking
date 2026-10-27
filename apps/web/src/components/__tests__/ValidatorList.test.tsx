import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { PARTICIPATION_RULE } from "@/lib/programme"
import { ValidatorList } from "../validators/ValidatorList"
import { TEST_ACCOUNTS, MOCK_VALIDATORS } from "@/__tests__/test-data"
import { ready, unavailable, loading } from "@/lib/figure"
import type { DirectoryEntry } from "@/hooks/useValidatorDirectory"
import type { EnsLookup } from "@/hooks/useEnsNames"
import { BETA_END_DAY, utcDayMs } from "@cobuilders/safenet-core"

const mockUseValidators = vi.fn()
const mockTotalStakes = vi.fn()
const mockDirectory = vi.fn()
const mockConsensus = vi.fn()
const mockEns = vi.fn()

vi.mock("@/hooks/useValidators", () => ({
  useValidators: () => mockUseValidators(),
}))

vi.mock("@/hooks/useStakingReads", () => ({
  useValidatorTotalStakes: () => mockTotalStakes(),
  useUserStakesOnValidators: vi.fn(() => ({
    data: undefined,
    isLoading: false,
  })),
}))

vi.mock("@/hooks/useValidatorDirectory", () => ({
  useValidatorDirectory: () => mockDirectory(),
}))

vi.mock("@/hooks/useConsensusFigures", () => ({
  useConsensusFigures: () => mockConsensus(),
}))

vi.mock("@/hooks/useEnsNames", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useEnsNames")>()),
  useEnsNames: () => mockEns(),
}))

vi.mock("@/components/validators/ValidatorCard", () => ({
  ValidatorCard: (p: { validator: string; isActive: boolean; delegators?: number; registeredAt?: number; missed?: bigint; missedLabel?: string; ensName?: string }) => (
    <div
      data-testid={`validator-card-${p.validator}`}
      data-active={p.isActive}
      data-delegators={p.delegators ?? ""}
      data-registered={p.registeredAt ?? ""}
      data-missed={p.missed?.toString() ?? ""}
      data-missed-label={p.missedLabel}
      data-ens={p.ensName ?? ""}
    >
      ValidatorCard
    </div>
  ),
}))

const SAFE = 10n ** 18n
const v1 = TEST_ACCOUNTS.validator1.toLowerCase()
const v2 = TEST_ACCOUNTS.validator2.toLowerCase()
const BETA_LAST = utcDayMs(BETA_END_DAY) / 1000

const entry = (delegators: number, timestamp: number): DirectoryEntry => ({
  isRegistered: true,
  delegators,
  delegatorsEver: delegators + 2,
  registeredAt: { block: 24_741_826n, timestamp },
})

/** Every new source answering: validator 2 has more stake, fewer delegators, a lower rate. */
function allSourcesAnswer() {
  mockUseValidators.mockReturnValue({ data: [...MOCK_VALIDATORS], isLoading: false, error: null, refetch: vi.fn() })
  mockTotalStakes.mockReturnValue({
    data: [
      { status: "success", result: 100n * SAFE },
      { status: "success", result: 900n * SAFE },
    ],
    isLoading: false,
  })
  mockDirectory.mockReturnValue({ entries: ready(new Map([[v1, entry(40, 1_774_529_219)], [v2, entry(7, 1_774_529_219)]]), "subgraph") })
  mockConsensus.mockReturnValue({
    subgraph: { status: "live" },
    participation: new Map([
      [v1, { rate: 0.99, attended: 990n, absences: 10n }],
      [v2, { rate: 0.98, attended: 980n, absences: 20n }],
    ]),
    window: { days: 14, from: BETA_LAST - 13 * 86_400, to: BETA_LAST },
    betaOnly: true,
  })
  mockEns.mockReturnValue(new Map<string, EnsLookup>([[v1, { status: "none" }], [v2, { status: "none" }]]))
}

const cardOrder = () => screen.getAllByTestId(/^validator-card-/).map((c) => c.dataset.testid?.replace("validator-card-", ""))

describe("ValidatorList", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    allSourcesAnswer()
  })

  it("shows loading skeletons when loading", () => {
    mockUseValidators.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    })

    const { container } = render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )

    const skeletons = container.querySelectorAll('[class*="animate-pulse"]')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it("shows error message on error", () => {
    mockUseValidators.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("RPC failed"),
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )

    expect(screen.getByText(/Failed to load validators/)).toBeInTheDocument()
  })

  it("shows empty state when no validators", () => {
    mockUseValidators.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )

    expect(screen.getByText(/No validators are currently available/)).toBeInTheDocument()
  })

  it("renders validator cards when data loaded", () => {
    mockUseValidators.mockReturnValue({
      data: [...MOCK_VALIDATORS],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )

    expect(screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator1}`)).toBeInTheDocument()
    expect(screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator2}`)).toBeInTheDocument()
  })

  it("states SEF's reward rule as text under the cards, where a tooltip cannot open on touch", () => {
    mockUseValidators.mockReturnValue({ data: [...MOCK_VALIDATORS], isLoading: false, error: null, refetch: vi.fn() })
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    expect(screen.getByText(PARTICIPATION_RULE)).toBeInTheDocument()
  })

  it("renders all validators without filtering", () => {
    mockUseValidators.mockReturnValue({
      data: [...MOCK_VALIDATORS],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })

    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )

    const cards = screen.getAllByText("ValidatorCard")
    expect(cards).toHaveLength(MOCK_VALIDATORS.length)
  })

  it("sorts by stake by default, then by participation and by delegators, largest first", () => {
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    expect(cardOrder()).toEqual([TEST_ACCOUNTS.validator2, TEST_ACCOUNTS.validator1])
    const sortBy = within(screen.getByRole("group", { name: "Sort by" }))
    expect(sortBy.getByRole("button", { name: "Total SAFE" })).toHaveAttribute("aria-pressed", "true")

    fireEvent.click(sortBy.getByRole("button", { name: "Participation" }))
    expect(cardOrder()).toEqual([TEST_ACCOUNTS.validator1, TEST_ACCOUNTS.validator2])

    fireEvent.click(sortBy.getByRole("button", { name: "Total SAFE" }))
    fireEvent.click(sortBy.getByRole("button", { name: "Delegators" }))
    expect(cardOrder()).toEqual([TEST_ACCOUNTS.validator1, TEST_ACCOUNTS.validator2])
  })

  it("filters to active validators, and says so when none is left", () => {
    mockUseValidators.mockReturnValue({
      data: [{ ...MOCK_VALIDATORS[0], isActive: false }, MOCK_VALIDATORS[1]],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    expect(cardOrder()).toHaveLength(2)
    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Active only" }))
    expect(cardOrder()).toEqual([TEST_ACCOUNTS.validator2])
  })

  it("shows the empty filter state when no validator is active", () => {
    mockUseValidators.mockReturnValue({
      data: MOCK_VALIDATORS.map((v) => ({ ...v, isActive: false })),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Active only" }))
    expect(screen.queryAllByTestId(/^validator-card-/)).toHaveLength(0)
    expect(screen.getByText(/No active validator/)).toBeInTheDocument()
  })

  it("passes each card its delegators, registration and Beta misses, and names the sources", () => {
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    const card = screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator1}`)
    expect(card.dataset.delegators).toBe("40")
    expect(card.dataset.registered).toBe("1774529219")
    expect(card.dataset.missed).toBe("10")
    expect(card.dataset.missedLabel).toBe("Missed, Beta's last 14 days")
    expect(screen.getByText(/Delegators and registration: the Mainnet subgraph/)).toBeInTheDocument()
    expect(screen.getByText(/Beta, 14 complete UTC days, 22 Sep 2026 to 5 Oct 2026\. Beta has ended/)).toBeInTheDocument()
    expect(screen.getByText("Names: SEF labels. No ENS primary name is set.")).toBeInTheDocument()
  })

  it("says why delegators and misses are missing when the subgraphs are unavailable", () => {
    mockDirectory.mockReturnValue({ entries: unavailable("The subgraph could not be queried.") })
    mockConsensus.mockReturnValue({ subgraph: { status: "degraded" }, participation: undefined, window: undefined, betaOnly: true })
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    const card = screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator1}`)
    expect(card.dataset.delegators).toBe("")
    expect(card.dataset.missed).toBe("")
    expect(screen.getByText(/Delegators and registration: unavailable\. The subgraph could not be queried\./)).toBeInTheDocument()
    expect(screen.getByText(/Missed ceremonies unavailable\./)).toBeInTheDocument()
  })

  it("names a validator by its ENS primary name when one is set, and says so", () => {
    mockDirectory.mockReturnValue({ entries: loading() })
    mockEns.mockReturnValue(new Map<string, EnsLookup>([[v1, { status: "found", name: "gnosis.eth" }], [v2, { status: "none" }]]))
    render(
      <MemoryRouter>
        <ValidatorList />
      </MemoryRouter>,
    )
    expect(screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator1}`).dataset.ens).toBe("gnosis.eth")
    expect(screen.getByTestId(`validator-card-${TEST_ACCOUNTS.validator2}`).dataset.ens).toBe("")
    expect(screen.getByText(/Names: ENS primary names, verified by reverse resolution/)).toBeInTheDocument()
  })
})
