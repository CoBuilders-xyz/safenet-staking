import { AdminError, deleteWebhook, describe, setWebhook, webhookInfo } from "../src/webhook-admin.js"

// The operator's commands for the Telegram webhook. DEPLOY.md has the order and the rollback.
//
//   telegram-webhook.ts set      register <ALERTS_URL>/telegram/webhook with the secret
//   telegram-webhook.ts info     print what Telegram holds
//   telegram-webhook.ts delete   remove the webhook, to go back to a Worker version that polls
//
// Reads TELEGRAM_BOT_TOKEN, and for `set` also TELEGRAM_WEBHOOK_SECRET and ALERTS_URL, from the
// environment. Prints no token and no secret.
const commands = { set: setWebhook, info: webhookInfo, delete: deleteWebhook }
const command = process.argv[2] as keyof typeof commands | undefined
if (!command || !Object.hasOwn(commands, command)) {
  console.error("Usage: telegram-webhook.ts <set|info|delete>")
  process.exit(2)
}
try {
  for (const line of describe(await commands[command](process.env), process.env)) console.log(line)
} catch (error) {
  // Only an AdminError has a message written for the operator, without credentials.
  console.error(`::error::${error instanceof AdminError ? error.message : "The Telegram webhook command failed"}`)
  process.exit(1)
}
