variable "account_id" {
  description = "Cloudflare account ID. Not a secret, but kept out of the repository: set it in terraform.tfvars or TF_VAR_account_id."
  type        = string
}

variable "zone_name" {
  description = "The Cloudflare zone that holds the hostnames. safenet.cobuilders.xyz needs a delegated subdomain zone (Enterprise only); cobuilders.xyz moves the whole domain to Cloudflare. DEPLOY.md explains both."
  type        = string
  default     = "safenet.cobuilders.xyz"
}

variable "create_zone" {
  description = "true creates the zone and outputs the name servers to delegate to. false looks up a zone that already exists in the account."
  type        = bool
  default     = true
}

variable "web_hostname" {
  description = "Hostname of the web interface. The API and alerts hostnames are subdomains of it."
  type        = string
  default     = "safenet.cobuilders.xyz"
}

variable "web_cname_target" {
  description = "The CNAME target Vercel shows for web_hostname, for example cname.vercel-dns.com. null creates no web record: use null only when GoDaddy keeps serving that name."
  type        = string
  default     = null
}

variable "attach_worker_domains" {
  description = "Attach the custom domains to the Workers. A custom domain needs its Worker, so set true only after the first deploy of both Workers."
  type        = bool
  default     = false
}
