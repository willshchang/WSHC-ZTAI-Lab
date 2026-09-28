# ============================================================
# TAILSCALE TAILNET SETTINGS
# ============================================================
# Manages global Tailnet-wide settings via Terraform.
#
# What this file configures:
# 1. HTTPS certificates — auto-provisioned TLS per device
# 2. Device auto-updates — keeps Tailscale clients current
#
# Why HTTPS certificates matter:
# Tailscale provisions valid Let's Encrypt TLS certificates
# per device via MagicDNS hostname — enabling HTTPS on
# self-hosted services without purchasing a domain or
# managing certificates manually.
#
# Device cert format:
# <hostname>.<tailnet-name>.ts.net
# e.g. tinyco-vm.hair-squeaker.ts.net
#
# Used in this lab for:
# - Mattermost HTTPS via Tailscale Serve
# - Eliminates self-signed certificate warnings
# - No domain purchase required
#
# To provision cert on a device after enabling:
# sudo tailscale cert tinyco-vm.hair-squeaker.ts.net
#
# Official reference:
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_settings
# https://tailscale.com/kb/1153/enabling-https
# ============================================================

# ============================================================
# IMPORT EXISTING TAILNET SETTINGS
# ============================================================
# Tailscale creates default tailnet settings on every new
# Tailnet. Terraform must import before managing.
# ============================================================
import {
  to = tailscale_tailnet_settings.main
  id = "settings"
}

resource "tailscale_tailnet_settings" "main" {
  # --------------------------------------------------------
  # HTTPS Certificates
  # --------------------------------------------------------
  # Enables Tailscale to provision Let's Encrypt TLS certs
  # for each device's MagicDNS hostname automatically.
  # Requires MagicDNS to be enabled (see dns.tf)
  # --------------------------------------------------------
  https_enabled = true

  # --------------------------------------------------------
  # Device Auto-Updates
  # --------------------------------------------------------
  # When enabled: Tailscale clients update automatically
  # Recommended for security — ensures latest WireGuard
  # and security patches are applied across all devices
  # --------------------------------------------------------
  devices_auto_updates_on = true

  # ============================================================
  # FUTURE EXPANSION — Additional tailnet settings
  # ============================================================
  # Uncomment as needed for production deployment:
  #
  # devices_approval_on = true
  # Require admin approval before new devices join tailnet
  # Recommended for production to prevent unauthorized access
  #
  # devices_key_duration_days = 180
  # How long before device keys expire (default 180 days)
  # Set to 0 to disable key expiry for infrastructure devices
  #
  # users_approval_on = true
  # Require admin approval before new users join tailnet
  #
  # acls_externally_managed_on = true
  # acls_external_link = "https://github.com/yourorg/tailscale-acls"
  # Lock ACL editing in admin console — enforce GitOps workflow
  # Prevents manual ACL changes outside of Terraform/git
  # ============================================================
}