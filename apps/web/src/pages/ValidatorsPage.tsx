import { useSearchParams } from "react-router-dom"
import { isAddress } from "viem"
import { ValidatorList } from "@/components/validators/ValidatorList"
import { PageHero } from "@/components/PageHero"
import { Term } from "@/components/ui/term"

export function ValidatorsPage() {
  const [searchParams] = useSearchParams()
  const rawDelegate = searchParams.get("delegate")
  const delegateParam = rawDelegate && isAddress(rawDelegate) ? rawDelegate : undefined

  return (
    <div className="space-y-8">
      <PageHero
        title="Safenet validators"
        subtitle={
          <>
            Select a <Term term="validator">validator</Term> to <Term term="staking">stake</Term> your SAFE tokens
          </>
        }
      />
      <ValidatorList autoOpenDelegate={delegateParam} />
    </div>
  )
}
