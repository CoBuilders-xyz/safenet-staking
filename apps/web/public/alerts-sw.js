/* This worker belongs only to the deployment scope. It caches no application or wallet data. */
self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()))
self.addEventListener("message", event => {
  if (event.data?.type !== "alerts-config" || typeof event.data.api !== "string") return
  const api = new URL(event.data.api)
  if (api.protocol !== "https:" && api.hostname !== "localhost" && api.hostname !== "127.0.0.1") return
  event.waitUntil(caches.open("alerts-settings").then(cache => cache.put(new URL("alerts-api", self.registration.scope), new Response(api.href))))
})
self.addEventListener("push", event => {
  event.waitUntil((async () => {
    const payload = event.data?.json()
    if (!payload || typeof payload.body !== "string" || typeof payload.ack !== "string") return
    await self.registration.showNotification("Safenet", { body: payload.body, tag: payload.ack, data: { url: new URL("./#/alerts", self.registration.scope).href } })
    const cache = await caches.open("alerts-settings")
    const config = await cache.match(new URL("alerts-api", self.registration.scope))
    if (config) {
      const api = (await config.text()).replace(/\/$/, "")
      await fetch(`${api}/delivery/ack`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ack: payload.ack }) })
    }
  })())
})
self.addEventListener("notificationclick", event => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(new URL("./#/alerts", self.registration.scope).href))
})
