output "zone_id" {
  description = "The zone that holds the Safenet hostnames."
  value       = local.zone_id
}

output "name_servers" {
  description = "The name servers to set in GoDaddy: NS records for the subdomain zone, or the domain's name servers when the whole domain moves."
  value       = var.create_zone ? cloudflare_zone.safenet[0].name_servers : data.cloudflare_zone.existing[0].name_servers
}

output "alerts_d1_database_id" {
  description = "Set as the GitHub variable ALERTS_D1_DATABASE_ID of the production environment."
  value       = cloudflare_d1_database.alerts.id
}

output "hostnames" {
  description = "Public origins: the REST API and the alerts Worker."
  value = {
    api    = "https://${local.api_hostname}"
    alerts = "https://${local.alerts_hostname}"
  }
}
