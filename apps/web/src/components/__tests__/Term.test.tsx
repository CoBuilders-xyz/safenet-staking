import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TooltipProvider } from "@radix-ui/react-tooltip"
import { Term } from "../ui/term"
import { definition } from "@/lib/glossary"

/** A finger on the screen: no hover first, as with a mouse. */
async function tap(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  await user.pointer({ keys: "[TouchA]", target })
}

function renderTerm(node: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{node}</TooltipProvider>)
}

describe("Term", () => {
  it("is a button named by its words, inside the sentence", () => {
    renderTerm(
      <p>
        Choose a <Term term="validator">validator</Term> first
      </p>,
    )
    expect(screen.getByRole("button", { name: "validator" })).toBeInTheDocument()
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument()
  })

  it("opens on a tap and closes on the next, so it works on a touch screen", async () => {
    const user = userEvent.setup()
    renderTerm(<Term term="slashing">slashing</Term>)

    await tap(user, screen.getByRole("button", { name: "slashing" }))
    expect(await screen.findByRole("tooltip")).toHaveTextContent(definition("slashing"))

    await tap(user, screen.getByRole("button", { name: "slashing" }))
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
  })

  it("opens on keyboard focus and closes on Escape", async () => {
    const user = userEvent.setup()
    renderTerm(<Term term="commission">Commission</Term>)

    await user.tab()
    expect(screen.getByRole("button", { name: "Commission" })).toHaveFocus()
    expect(await screen.findByRole("tooltip")).toHaveTextContent(definition("commission"))

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
  })

  it("opens on a mouse click before the hover delay, and Enter toggles it from the keyboard", async () => {
    const user = userEvent.setup()
    render(
      <TooltipProvider>
        <Term term="validator">validator</Term>
      </TooltipProvider>,
    )

    await user.click(screen.getByRole("button", { name: "validator" }))
    expect(await screen.findByRole("tooltip")).toHaveTextContent(definition("validator"))

    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument())
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("tooltip")).toBeInTheDocument()
  })

  it("describes the button with its explanation while open", async () => {
    const user = userEvent.setup()
    renderTerm(<Term term="rewards">rewards</Term>)

    await tap(user, screen.getByRole("button", { name: "rewards" }))
    await screen.findByRole("tooltip")
    expect(screen.getByRole("button", { name: "rewards" })).toHaveAccessibleDescription(definition("rewards"))
  })

  it("puts the contract's unstaking period into the explanation", async () => {
    const user = userEvent.setup()
    renderTerm(
      <Term term="unstakingPeriod" unstakingPeriod={172_800n}>
        Unstaking period
      </Term>,
    )

    await tap(user, screen.getByRole("button", { name: "Unstaking period" }))
    expect(await screen.findByRole("tooltip")).toHaveTextContent("waits in the staking contract for 2 days")
  })
})
