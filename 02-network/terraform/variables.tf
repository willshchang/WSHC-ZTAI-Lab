# ============================================================
# TAILSCALE TERRAFORM VARIABLES
# ============================================================
# All configuration values are defined here as variables.
# Actual values live in terraform.tfvars (gitignored).
#
# This makes the codebase portable: swap tfvars and the same
# Terraform deploys to any Tailnet.
#
# Validation blocks catch bad values at plan time, before
# anything reaches the live tailnet.
#
# Official reference:
# https://developer.hashicorp.com/terraform/language/values/variables#custom-validation-rules
# ============================================================

# ============================================================
# AUTHENTICATION
# ============================================================
# The provider talks to the tailnet that owns the OAuth client,
# so no tailnet name variable is needed.

variable "oauth_client_id" {
  description = "Tailscale OAuth client ID, from tailscale.com/admin/settings/oauth"
  type        = string
  sensitive   = true
}

variable "oauth_client_secret" {
  description = "Tailscale OAuth client secret, from tailscale.com/admin/settings/oauth"
  type        = string
  sensitive   = true
}

# ============================================================
# DEVICE DNS NAMES
# ============================================================
# The data sources in tags.tf look devices up by their FULL
# MagicDNS name (host.<tailnet>.ts.net), not the short hostname.
# Apple TVs report the same generic hostname, so only the full
# name is unique.
# https://github.com/tailscale/terraform-provider-tailscale/blob/v0.28.0/docs/data-sources/device.md
#
# Find them with: tailscale status --json (the DNSName field,
# without the trailing dot).
# ============================================================

variable "vm_DNSname" {
  description = "Full MagicDNS name of the Azure VM (SSH server), e.g. tinyco-vm.<tailnet>.ts.net"
  type        = string
}

variable "subnet_router_primary_DNSname" {
  description = "Full MagicDNS name of the primary Apple TV subnet router, e.g. tv-primary.<tailnet>.ts.net"
  type        = string
}

variable "subnet_router_ha_DNSname" {
  description = "Full MagicDNS name of the HA (failover) Apple TV subnet router, e.g. tv-ha.<tailnet>.ts.net"
  type        = string
}

# ============================================================
# NETWORK CONFIGURATION
# ============================================================

variable "home_subnet_cidr" {
  description = "Home LAN subnet CIDR advertised by Apple TV subnet routers, e.g. 192.168.1.0/24"
  type        = string

  validation {
    condition     = can(cidrhost(var.home_subnet_cidr, 1))
    error_message = "home_subnet_cidr must be a valid CIDR block such as 192.168.1.0/24."
  }
}

# ============================================================
# EXIT NODE SWITCH
# ============================================================
# One on/off switch for exit node approval on both Apple TV
# routers. WHY a switch: exit node approval lives in the same
# Terraform resource as subnet routes. If the code does not
# list the exit node routes, terraform apply removes any
# exit node that was approved by hand in the admin console.
#
# true  = Apple TVs approved as exit nodes (all internet
#         traffic can be routed through them)
# false = Apple TVs route the home LAN subnet only
#
# The device must still advertise itself as an exit node
# (Tailscale app on tvOS). This switch only approves it.
# ============================================================

variable "exit_node_enabled" {
  description = "Approve the Apple TV subnet routers as exit nodes"
  type        = bool
  default     = false
}

# ============================================================
# IDENTITY
# ============================================================

variable "admin_email" {
  description = "Tailscale login of the admin, used in ACL grants and SSH rules"
  type        = string
  # Example: "admin@example.com"
}

variable "ssh_users" {
  description = "Non-root Linux users the admin may log in as over Tailscale SSH without re-authentication"
  type        = list(string)
  # Example: ["tinyco-admin", "your-linux-user"]

  # Root has its own "check" rule in acl.tf. Listing it here
  # would let root in through the "accept" rule as well.
  validation {
    condition     = !contains(var.ssh_users, "root")
    error_message = "Do not put \"root\" in ssh_users. Root SSH is handled by the separate check rule in acl.tf."
  }
}

variable "ssh_root_check_period" {
  description = "How long a browser re-authentication for root SSH stays valid (Tailscale checkPeriod), e.g. 12h"
  type        = string
  default     = "12h"

  # Tailscale accepts 1 minute to 168 hours (one week), or "always"
  # for a check on every connection.
  # https://tailscale.com/docs/reference/syntax/policy-file
  # Each try() stands alone because Terraform's || does not skip the
  # right-hand side: tonumber("12h") would otherwise error.
  validation {
    condition = (
      var.ssh_root_check_period == "always" ||
      try(tonumber(regex("^([0-9]+)m$", var.ssh_root_check_period)[0]) >= 1 && tonumber(regex("^([0-9]+)m$", var.ssh_root_check_period)[0]) <= 10080, false) ||
      try(tonumber(regex("^([0-9]+)h$", var.ssh_root_check_period)[0]) >= 1 && tonumber(regex("^([0-9]+)h$", var.ssh_root_check_period)[0]) <= 168, false)
    )
    error_message = "ssh_root_check_period must be \"always\" or 1m to 168h, such as 30m or 12h."
  }
}

# ============================================================
# TAGS
# ============================================================
# Tag names are referenced through these variables in acl.tf,
# tags.tf and keys.tf, so a rename happens here only. Every tag
# must start with "tag:".
# ============================================================

variable "tag_server" {
  description = "Tag for cloud infrastructure devices (Azure VM)"
  type        = string
  default     = "tag:server"

  validation {
    condition     = startswith(var.tag_server, "tag:")
    error_message = "tag_server must start with \"tag:\"."
  }
}

variable "tag_subnet_router" {
  description = "Tag for network infrastructure devices (Apple TV subnet routers)"
  type        = string
  default     = "tag:subnet-router"

  validation {
    condition     = startswith(var.tag_subnet_router, "tag:")
    error_message = "tag_subnet_router must start with \"tag:\"."
  }
}

# ============================================================
# TERRAFORM MANAGER TAG
# ============================================================
# tag:terraform is a manager tag assigned to the Terraform
# OAuth client in the Tailscale admin console. It acts as
# an intermediary owner, allowing the OAuth client to
# generate auth keys for infrastructure tags (tag:server,
# tag:subnet-router) without requiring direct tag ownership.
#
# Tag ownership chain:
# OAuth client -> tag:terraform -> tag:server
#
# Without this chain, Terraform cannot generate auth keys
# with infrastructure tags. Background:
# https://github.com/tailscale/tailscale/issues/8299
# ============================================================

variable "tag_terraform" {
  description = "Manager tag for Terraform OAuth client, owns all infrastructure tags"
  type        = string
  default     = "tag:terraform"

  validation {
    condition     = startswith(var.tag_terraform, "tag:")
    error_message = "tag_terraform must start with \"tag:\"."
  }
}
