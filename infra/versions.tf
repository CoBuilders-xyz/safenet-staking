terraform {
  # 1.10 adds use_lockfile, the S3 backend's native lock. R2 evaluates its conditional write atomically.
  required_version = ">= 1.10"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.29"
    }
  }

  # Remote state in a Cloudflare R2 bucket, through the S3 backend. The bucket name and endpoint
  # come from backend.hcl (git-ignored; copy backend.hcl.example). The R2 access key comes from
  # AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Nothing secret is committed.
  backend "s3" {
    key                         = "safenet/infra.tfstate"
    region                      = "auto"
    use_lockfile                = true
    use_path_style              = true
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }
}

# The token comes from CLOUDFLARE_API_TOKEN. DEPLOY.md lists the permissions it needs.
provider "cloudflare" {}
