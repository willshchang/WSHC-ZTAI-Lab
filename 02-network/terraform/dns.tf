# ============================================================
# TAILSCALE DNS CONFIGURATION
# ============================================================
# Manages Tailnet-wide DNS settings via Terraform.
#
# What this file configures:
# 1. MagicDNS — automatic hostname resolution across Tailnet
#
# What is managed elsewhere:
# - HTTPS certificates → settings.tf (tailscale_tailnet_settings)
# - Custom nameservers → future expansion (requires domain)
# - Split DNS → future expansion (requires custom nameservers)
#
# Why MagicDNS matters:
# Without MagicDNS, devices are reached by Tailscale IP only
# e.g. 100.93.4.6. With MagicDNS, devices are reachable by
# hostname e.g. tinyco-vm.hair-squeaker.ts.net — making the
# network feel like a real corporate LAN regardless of where
# devices physically are.
#
# Official reference:
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/dns_preferences
# https://tailscale.com/kb/1081/magicdns
# ============================================================

# ============================================================
# IMPORT EXISTING DNS PREFERENCES
# ============================================================
# Tailscale creates default DNS preferences on every new
# Tailnet. Terraform must import the existing configuration
# before managing it — otherwise apply errors with
# "resource already exists".
#
# Safe to leave permanently — skipped on subsequent applies
# when resource is already in state.
# ============================================================
import {
  to = tailscale_dns_preferences.main
  id = "dns_preferences"
}

resource "tailscale_dns_preferences" "main" {
  # --------------------------------------------------------
  # MagicDNS
  # --------------------------------------------------------
  # When enabled: devices resolve each other by hostname
  # When disabled: Tailscale IP addresses only
  #
  # Recommended: always enabled for usability
  # Required for: HTTPS certificates, Tailscale Serve,
  # human-readable SSH targets (tailscale ssh tinyco-vm)
  # --------------------------------------------------------
  magic_dns = true
}

# ============================================================
# FUTURE EXPANSION — Custom DNS (commented out)
# ============================================================
# Uncomment and configure when a custom domain is available.
#
# resource "tailscale_dns_nameservers" "custom" {
#   nameservers = [
#     "8.8.8.8",
#     "8.8.4.4"
#   ]
# }
#
# resource "tailscale_dns_split_nameservers" "internal" {
#   domain      = "yourdomain.com"
#   nameservers = ["10.0.0.53"]
# }
# ============================================================