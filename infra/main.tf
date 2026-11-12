locals {
  api_hostname    = "api.${var.web_hostname}"
  alerts_hostname = "alerts.${var.web_hostname}"
  zone_id         = var.create_zone ? cloudflare_zone.safenet[0].id : data.cloudflare_zone.existing[0].zone_id

  # The Worker names in apps/api/cloudflare.config.ts and apps/alerts/cloudflare.config.ts.
  workers = {
    api    = { hostname = local.api_hostname, service = "safenet-api" }
    alerts = { hostname = local.alerts_hostname, service = "safenet-alerts" }
  }
}

resource "cloudflare_zone" "safenet" {
  count   = var.create_zone ? 1 : 0
  account = { id = var.account_id }
  name    = var.zone_name
  type    = "full"
}

data "cloudflare_zone" "existing" {
  count = var.create_zone ? 0 : 1
  filter = {
    name    = var.zone_name
    account = { id = var.account_id }
  }
}

# The web interface stays on Vercel. When the zone answers for web_hostname, it must point there,
# DNS only: Vercel issues its own certificate and Cloudflare's proxy would hide the origin.
# At a zone apex, Cloudflare flattens the CNAME.
resource "cloudflare_dns_record" "web" {
  count   = var.web_cname_target == null ? 0 : 1
  zone_id = local.zone_id
  name    = var.web_hostname
  type    = "CNAME"
  content = var.web_cname_target
  proxied = false
  ttl     = 300
  comment = "Safenet web interface on Vercel. Managed by Terraform in safenet-staking/infra."
}

# Custom domains create their own proxied DNS record and certificate.
# The Worker configs declare no domains, so `cf deploy` leaves these alone.
resource "cloudflare_workers_custom_domain" "worker" {
  for_each   = var.attach_worker_domains ? local.workers : {}
  account_id = var.account_id
  zone_id    = local.zone_id
  hostname   = each.value.hostname
  service    = each.value.service
}

resource "cloudflare_d1_database" "alerts" {
  account_id = var.account_id
  name       = "safenet-alerts"
  # One writer; no read replicas, so every read sees the last committed write.
  read_replication = { mode = "disabled" }

  lifecycle {
    # Subscriptions and delivery history live here. Destroying it needs a deliberate code change.
    prevent_destroy = true
  }
}
