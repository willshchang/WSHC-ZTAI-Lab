# ============================================================
# TAILSCALE TERRAFORM VARIABLES
# ============================================================
# All configuration values are defined here as variables.
# Zero hardcoded values exist in any .tf logic file —
# actual values live in terraform.tfvars (gitignored).
#
# This makes the codebase fully portable — swap tfvars
# and the same Terraform deploys to any Tailnet.
#
# Official reference:
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs
# ============================================================

# ============================================================
# AUTHENTICATION
# ============================================================

variable "oauth_client_id" {
  description = "Tailscale OAuth client ID — from tailscale.com/admin/settings/oauth"
  type        = string
  sensitive   = true
}

variable "oauth_client_secret" {
  description = "Tailscale OAuth client secret — from tailscale.com/admin/settings/oauth"
  type        = string
  sensitive   = true
}

# ============================================================
# TAILNET IDENTITY
# ============================================================

variable "tailnet" {
  description = "Your Tailnet name — found in tailscale.com/admin/settings/general"
  type        = string
  # Example: "hair-squeaker.ts.net" or your organisation domain
}

# ============================================================
# DEVICE DNSNAMES
# ============================================================
# Device DNSnames as they appear in the Tailscale admin
# console. Used by data sources to look up device IDs
# without hardcoding them.
#
# Run `tailscale status` to confirm DNSnames.
# ============================================================

variable "vm_DNSname" {
  description = "DNSname of the Azure VM subnet router and SSH server"
  type        = string
  # Example: "tinyco-vm"
}

variable "subnet_router_primary_DNSname" {
  description = "DNSname of the primary Apple TV subnet router"
  type        = string
  # Example: "iwilltvliving"
}

variable "subnet_router_ha_DNSname" {
  description = "DNSname of the HA (failover) Apple TV subnet router"
  type        = string
  # Example: "iwilltvmaster"
}

# ============================================================
# NETWORK CONFIGURATION
# ============================================================

variable "home_subnet_cidr" {
  description = "Home LAN subnet CIDR advertised by Apple TV subnet routers"
  type        = string
  # Example: "192.168.1.0/24"
}

# ============================================================
# IDENTITY
# ============================================================

variable "admin_email" {
  description = "Tailscale account email — used in ACL grants and SSH rules"
  type        = string
  # Example: "will.sh.chang@gmail.com"
}

# ============================================================
# TAGS
# ============================================================
# Tag names must match exactly between variables.tf, acl.tf,
# and tags.tf. Changing a tag name requires updating all
# three files consistently.
# ============================================================

variable "tag_server" {
  description = "Tag for cloud infrastructure devices (Azure VM)"
  type        = string
  default     = "tag:server"
}

variable "tag_subnet_router" {
  description = "Tag for network infrastructure devices (Apple TV subnet routers)"
  type        = string
  default     = "tag:subnet-router"
}

# ============================================================
# TERRAFORM MANAGER TAG
# ============================================================
# tag:terraform is a manager tag assigned to the Terraform
# OAuth client in the Tailscale admin console. It acts as
# an intermediary owner — allowing the OAuth client to
# generate auth keys for infrastructure tags (tag:server,
# tag:subnet-router) without requiring direct tag ownership.
#
# Tag ownership chain:
# OAuth client → tag:terraform → tag:server
#
# Without this chain, Terraform cannot generate auth keys
# with infrastructure tags — a known Tailscale OAuth
# limitation documented in:
# https://github.com/tailscale/tailscale/issues/8299
# ============================================================

variable "tag_terraform" {
  description = "Manager tag for Terraform OAuth client — owns all infrastructure tags"
  type        = string
  default     = "tag:terraform"
}