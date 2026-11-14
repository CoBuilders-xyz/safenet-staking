import type { TFunction } from "i18next"
import type { AlertErrorCode } from "@/hooks/useAlerts"

/**
 * One message per failure, so the user knows what happened and what to do next. The service
 * answers "rate" for two limits: `during` says which request was refused.
 */
export function alertErrorMessage(t: TFunction, code: AlertErrorCode, maxSubscriptions: number, during?: "test"): string {
  switch (code) {
    case "session": return t("alerts.errorSession", "Your session expired. Sign again to continue.")
    case "signature": return t("alerts.errorSignature", "The signature could not be verified. Safe signatures require threshold approval: once the other owners approve, press Retry.")
    case "rejected": return t("alerts.errorRejected", "The message was not signed. Sign it to manage alerts.")
    case "limit": return t("alerts.limitReached", "You have {{max}} subscriptions, the maximum. Delete one to add another.", { max: maxSubscriptions })
    case "telegram_unavailable": return t("alerts.errorTelegramUnavailable", "Telegram alerts are not available right now. Try again later, or use browser notifications.")
    case "push_unavailable": return t("alerts.errorPushUnavailable", "Browser notifications are not available right now. Try again later, or use Telegram.")
    case "duplicate": return t("alerts.errorDuplicate", "You already have a subscription with these same alerts on this channel. Change the selection, or use the existing one.")
    case "rate": return during === "test"
      ? t("alerts.errorRateTestMinute", "One test notification per minute for each subscription. Wait a minute, then try again.")
      : t("alerts.errorRateSign", "Too many sign-in requests for this wallet. Wait five minutes, then sign again.")
    case "delivery": return t("alerts.errorDeliveryTestRetry", "The test notification could not be delivered. Try again in a minute.")
    case "forbidden": return t("alerts.errorForbidden", "The alerts service does not accept requests from this address of the site. Open the official site and try again.")
    case "expired": return t("alerts.errorExpired", "This subscription can no longer deliver. Delete it and subscribe again.")
    case "linked": return t("alerts.errorLinked", "Telegram is already connected for this subscription.")
    case "not_linked": return t("alerts.errorNotLinked", "Connect Telegram first: get a link, open it and press Start.")
    case "not_found": return t("alerts.errorGone", "This subscription no longer exists.")
    case "permission": return t("alerts.errorPermission", "Notifications are blocked for this site. Allow them in your browser settings, then subscribe again.")
    case "unsupported": return t("alerts.errorUnsupported", "This browser cannot receive notifications here. On iOS, install the app on your home screen first.")
    case "push": return t("alerts.errorPush", "This browser could not be registered for notifications. Try again.")
    case "invalid": return t("alerts.errorInvalid", "The alerts service refused these settings. Check the values and try again.")
    case "network": return t("alerts.errorNetwork", "The alerts service did not answer. Check your connection and try again.")
    default: return t("alerts.errorUnavailable", "The alerts service is unavailable. Try again later.")
  }
}
