# ============================================================
# TAILSCALE TERRAFORM PROVIDER
# ============================================================
# Official Terraform provider for Tailscale. Manages Tailnet
# configuration via the Tailscale API.
#
# What this file does:
# - Declares the Tailscale provider and version constraints
# - Configures API authentication via OAuth client credentials
#
# Prerequisites (manual, IaC boundary):
# - Tailscale account created at tailscale.com
# - All devices installed and enrolled in the Tailnet
# - OAuth client created in Tailscale admin console:
#   tailscale.com/admin/settings/oauth
#
# Official Tailscale Terraform blog:
# https://tailscale.com/blog/terraform
#
# Provider docs for the locked version (0.28.0):
# https://github.com/tailscale/terraform-provider-tailscale/tree/v0.28.0/docs
# ============================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    tailscale = {
      source = "tailscale/tailscale"
      # Matches the version recorded in .terraform.lock.hcl (0.28.0).
      # After changing this line, run `terraform init` locally so the
      # lock file records the new constraint, and commit the lock file.
      version = "~> 0.28"
    }
  }
}

# ============================================================
# PROVIDER CONFIGURATION
# ============================================================
# Authenticates to the Tailscale API using OAuth client
# credentials, recommended over API keys because the access
# tokens are short-lived and the client has granular scopes.
#
# Authentication values are injected via terraform.tfvars
# and never hardcoded (tfvars is gitignored). No tailnet
# argument is set: the provider uses the tailnet that owns
# the OAuth client.
#
# To create OAuth credentials:
# 1. Go to tailscale.com/admin/settings/oauth
# 2. Create new OAuth client
# 3. Grant these scopes, all Write (console label = API scope):
#    - Devices > Core = devices:core
#        tags: tag:server, tag:subnet-router, tag:terraform
#    - Devices > Routes = devices:routes
#    - General > Policy File = policy_file
#    - General > DNS = dns
#    - Keys > Auth Keys = auth_keys
#        tags: tag:server
#    - Settings > Networking Settings (used by tailnet_settings.tf)
#    Scope reference: https://tailscale.com/kb/1623/trust-credentials
#    (policy_file also needs devices:posture_attributes and
#    devices:core:read)
# 4. Copy client ID and secret to terraform.tfvars
# ============================================================
provider "tailscale" {
  oauth_client_id     = var.oauth_client_id
  oauth_client_secret = var.oauth_client_secret
}
