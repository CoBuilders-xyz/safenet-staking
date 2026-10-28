import { useTranslation } from "react-i18next"
import { useSearchParams } from "react-router-dom"
import { isAddress } from "viem"
import { ValidatorList } from "@/components/validators/ValidatorList"
import { PageHero } from "@/components/PageHero"

export function ValidatorsPage() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const rawDelegate = searchParams.get("delegate")
  const delegateParam = rawDelegate && isAddress(rawDelegate) ? rawDelegate : undefined

  return (
    <div className="space-y-8">
      <PageHero
        title={t("validators.safenetValidators", "Safenet validators")}
        subtitle={t("validators.selectAValidatorToStakeYourSafeTokens", "Select a validator to stake your SAFE tokens")}
      />
      <ValidatorList autoOpenDelegate={delegateParam} />
    </div>
  )
}
