# ============================================================
# TAILSCALE TERRAFORM PROVIDER
# ============================================================
# Official Terraform provider for Tailscale — manages Tailnet
# configuration via the Tailscale API.
#
# What this file does:
# - Declares the Tailscale provider and version constraints
# - Configures API authentication via OAuth client credentials
#
# Prerequisites (manual — IaC boundary):
# - Tailscale account created at tailscale.com
# - All devices installed and enrolled in the Tailnet
# - OAuth client created in Tailscale admin console:
#   tailscale.com/admin/settings/oauth
#
# Official Tailscale Terraform blog:
# https://tailscale.com/blog/terraform
#
# Official Terraform provider registry:
# https://registry.terraform.io/providers/tailscale/tailscale/latest
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs
# ============================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    tailscale = {
      source  = "tailscale/tailscale"
      version = "~> 0.18" # bump from 0.17 to get https_enabled
    }
  }
}

# ============================================================
# PROVIDER CONFIGURATION
# ============================================================
# Authenticates to the Tailscale API using OAuth client
# credentials — recommended over API keys for production
# as OAuth tokens are short-lived and auto-rotating.
#
# Authentication values are injected via terraform.tfvars
# and never hardcoded — tfvars is gitignored.
#
# To create OAuth credentials:
# 1. Go to tailscale.com/admin/settings/oauth
# 2. Create new OAuth client
# 3. Grant required scopes:
#    - acl:write        — manage ACL policy
#    - devices:read     — read device list
#    - devices:write    — manage device settings
#    - dns:write        — manage DNS settings
# 4. Copy client ID and secret to terraform.tfvars
# ============================================================
provider "tailscale" {
  oauth_client_id     = var.oauth_client_id
  oauth_client_secret = var.oauth_client_secret
} # Terraform Validate CI
