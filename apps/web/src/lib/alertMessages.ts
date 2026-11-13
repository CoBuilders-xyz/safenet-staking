import type { TFunction } from "i18next"
import type { AlertErrorCode } from "@/hooks/useAlerts"

/** One sentence per failure, so the user knows what to do next. */
export function alertErrorMessage(t: TFunction, code: AlertErrorCode, maxSubscriptions: number): string {
  switch (code) {
    case "session": return t("alerts.errorSession", "Your session expired. Sign again to continue.")
    case "signature": return t("alerts.errorSignature", "The signature could not be verified. Safe signatures require threshold approval: once the other owners approve, press Retry.")
    case "rejected": return t("alerts.errorRejected", "The message was not signed. Sign it to manage alerts.")
    case "limit": return t("alerts.limitReached", "You have {{max}} subscriptions, the maximum. Delete one to add another.", { max: maxSubscriptions })
    case "telegram_unavailable": return t("alerts.errorTelegramUnavailable", "Telegram alerts are not available right now. Try again later, or use browser notifications.")
    case "push_unavailable": return t("alerts.errorPushUnavailable", "Browser notifications are not available right now. Try again later, or use Telegram.")
    case "rate": return t("alerts.errorRate", "Too many requests. Wait a minute, then try again.")
    case "delivery": return t("alerts.errorDelivery", "The message could not be delivered. Try again in a minute.")
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
