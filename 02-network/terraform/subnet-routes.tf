# ============================================================
# TAILSCALE SUBNET ROUTE APPROVALS
# ============================================================
# Approves subnet routes advertised by enrolled devices.
#
# How subnet routing works:
# 1. Device advertises a subnet route (manual/CLI step)
# 2. Admin approves the route (THIS FILE — IaC step)
# 3. Other Tailnet devices accept routes (manual/CLI step)
# 4. Tailnet devices can reach non-Tailscale LAN devices
#
# IaC boundary — what Terraform manages here:
# APPROVAL of advertised routes only. Advertising routes
# is a device-level operation done via CLI or app:
#
# Apple TV (tvOS):
#   Tailscale app → Settings → Enable Subnet Router
#
# Linux VM:
#   sudo tailscale set --advertise-routes=192.168.1.0/24
#
# Linux client accepting routes:
#   sudo tailscale set --accept-routes
#   (Windows/macOS/iOS/tvOS accept routes automatically)
#
# Why approval matters:
# A rogue subnet router cannot hijack Tailnet traffic without
# explicit admin approval — this is Zero Trust at the
# network routing layer.
#
# Official reference:
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_subnet_routes
# https://tailscale.com/docs/features/subnet-routers
# ============================================================

# ============================================================
# DATA SOURCES — reuse from tags.tf
# ============================================================
# Device are already defined in tags.tf.
# Terraform shares data source results within the same
# module — no need to redefine them here.
#
# Devices referenced:
# - data.tailscale_device.subnet_router_primary (tags.tf)
# - data.tailscale_device.subnet_router_ha (tags.tf)
# ============================================================

# ============================================================
# PRIMARY SUBNET ROUTER — Living Room Apple TV
# ============================================================
# Approves the home LAN subnet route advertised by the
# primary Apple TV subnet router.
#
# This device is the active primary router for
# 192.168.1.0/24 — connected via ethernet for lowest
# latency and most reliable connectivity.
#
# HA behaviour:
# When both primary and HA routers advertise the same subnet,
# Tailscale automatically selects the primary based on
# lowest latency. If primary goes offline, failover to HA
# occurs within ~15 seconds — zero client reconfiguration.
#
# Production expansion:
# Add additional subnet routes as office locations grow:
# routes = ["192.168.1.0/24", "10.10.0.0/24"]
# ============================================================
resource "tailscale_device_subnet_routes" "primary" {
  device_id = data.tailscale_device.subnet_router_primary.id

  # Subnets this device is approved to route
  # Must match exactly what the device advertises
  # Verify with: tailscale status --json | grep PrimaryRoutes
  routes = [var.home_subnet_cidr]

  depends_on = [tailscale_acl.policy]
}

# ============================================================
# HA SUBNET ROUTER — Bedroom Apple TV
# ============================================================
# Approves the same home LAN subnet route on the secondary
# Apple TV — enabling automatic HA failover.
#
# This device is the standby router — connected via WiFi.
# Higher latency than primary (ethernet) so Tailscale
# keeps it in standby until primary is unavailable.
#
# Failover verified:
# Disabled primary route in admin console → pinged
# 192.168.1.254 from Azure VM → 4/4 packets received
# via HA router within ~5 seconds. Zero client changes.
#
# Production note:
# In production, each subnet router would advertise a
# different subnet representing a different physical site:
# Primary:  routes = ["192.168.1.0/24"]  # HQ LAN
# HA/Branch: routes = ["10.10.0.0/24"]   # Branch LAN
# ============================================================
resource "tailscale_device_subnet_routes" "ha" {
  device_id = data.tailscale_device.subnet_router_ha.id

  # Same subnet as primary — enables HA failover
  # Tailscale selects one as PrimaryRoutes, other as standby
  routes = [var.home_subnet_cidr]

  depends_on = [tailscale_acl.policy]
}

# ============================================================
# VERIFICATION COMMANDS
# ============================================================
# After terraform apply, verify routes are active:
#
# Check active subnet routers from any Tailnet device:
# tailscale status --json | python3 -c "
# import json,sys
# data=json.load(sys.stdin)
# for peer in data.get('Peer',{}).values():
#     routes=peer.get('PrimaryRoutes',[])
#     advertised=peer.get('AdvertisedRoutes',[])
#     if routes or advertised:
#         print(peer['HostName'])
#         print('  Primary:', routes)
#         print('  Advertised:', advertised)
# "
#
# Test site-to-site connectivity from Azure VM:
# ping -c 4 192.168.1.254   # Telus modem
# ping -c 4 192.168.1.59    # ASUS AP
# ============================================================