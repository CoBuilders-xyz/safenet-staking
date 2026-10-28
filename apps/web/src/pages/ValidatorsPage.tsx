import { Trans, useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { isAddress } from "viem"
import { ValidatorList } from "@/components/validators/ValidatorList"
import { PageHero } from "@/components/PageHero"
import { Term } from "@/components/ui/term"

export function ValidatorsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const rawDelegate = searchParams.get("delegate")
  const delegateParam = rawDelegate && isAddress(rawDelegate) ? rawDelegate : undefined

  return (
    <div className="space-y-8">
      <PageHero
        title={t("validators.safenetValidators", "Safenet validators")}
        subtitle={<Trans i18nKey="onboarding.hero.validators" defaults="Select a <validator>validator</validator> to <staking>stake</staking> your SAFE tokens" components={{ validator: <Term term="validator" children={null} />, staking: <Term term="staking" children={null} /> }} />}
      />
      <ValidatorList autoOpenDelegate={delegateParam} />
    </div>
  )
}
