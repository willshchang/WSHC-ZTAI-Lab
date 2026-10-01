# ============================================================
# TAILSCALE DEVICE TAG ASSIGNMENTS
# ============================================================
# Assigns tags to enrolled Tailnet devices using data sources
# to look up device IDs dynamically — zero hardcoded IDs.
#
# Tags transfer device ownership from the user account to
# the tag. Access is then controlled exclusively via ACL
# grants defined in acl.tf.
#
# IMPORTANT — Dependency on acl.tf:
# tagOwners must be defined in acl.tf BEFORE tags can be
# assigned here. Terraform handles this automatically via
# the implicit dependency on tailscale_acl.policy.
#
# IMPORTANT — Manual prerequisite:
# Devices must be enrolled in the Tailnet before tags can
# be assigned. Run `tailscale status` to confirm all devices
# are visible before running terraform apply.
#
# Official reference:
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_tags
# ============================================================

# ============================================================
# DATA SOURCES — Dynamic device lookup
# ============================================================
# Looks up device IDs by full MagicDNS name rather than
# hardcoding them. Device IDs change if a device is re-enrolled,
# and data sources always fetch the current ID at plan time.
#
# The `name` argument takes the FULL name, e.g.
# tinyco-vm.<tailnet>.ts.net, not the short hostname:
# https://github.com/tailscale/terraform-provider-tailscale/blob/v0.28.0/docs/data-sources/device.md
#
# Find it with `tailscale status --json` (DNSName field, drop
# the trailing dot).
# ============================================================

data "tailscale_device" "vm" {
  # Azure VM, cloud infrastructure
  # Full MagicDNS name, e.g. tinyco-vm.<tailnet>.ts.net
  name = var.vm_DNSname
}

data "tailscale_device" "subnet_router_primary" {
  # Primary Apple TV, primary subnet router
  # Full MagicDNS name, e.g. tv-primary.<tailnet>.ts.net
  name = var.subnet_router_primary_DNSname
}

data "tailscale_device" "subnet_router_ha" {
  # HA Apple TV, HA failover subnet router
  # Full MagicDNS name, e.g. tv-ha.<tailnet>.ts.net
  name = var.subnet_router_ha_DNSname
}

# ============================================================
# TAG ASSIGNMENTS
# ============================================================
# Assigns infrastructure tags to enrolled devices.
# Each device gets exactly one tag reflecting its function.
#
# tag:server        → Azure VM (cloud infrastructure)
# tag:subnet-router → Apple TVs (network infrastructure)
#
# Production expansion:
# Add new tag assignments as infrastructure grows:
# - Additional VMs: tag:server
# - Additional subnet routers: tag:subnet-router
# - Database servers: tag:database (define in acl.tf first)
# - Build servers: tag:build-server (define in acl.tf first)
# ============================================================

resource "tailscale_device_tags" "vm" {
  # Assigns tag:server to the Azure VM
  # Effect: ownership transfers from user account to tag
  # Access: controlled exclusively by ACL grants in acl.tf
  device_id = data.tailscale_device.vm.id
  tags      = [var.tag_server]

  # Explicit dependency ensures ACL tagOwners are defined
  # before tag assignment is attempted
  depends_on = [tailscale_acl.policy]
}

resource "tailscale_device_tags" "subnet_router_primary" {
  # Assigns tag:subnet-router to primary Apple TV
  # This device is the primary subnet router for 192.168.1.0/24
  device_id = data.tailscale_device.subnet_router_primary.id
  tags      = [var.tag_subnet_router]

  depends_on = [tailscale_acl.policy]
}

resource "tailscale_device_tags" "subnet_router_ha" {
  # Assigns tag:subnet-router to HA Apple TV
  # This device is the HA failover subnet router
  # Tailscale automatically fails over if primary goes offline
  device_id = data.tailscale_device.subnet_router_ha.id
  tags      = [var.tag_subnet_router]

  depends_on = [tailscale_acl.policy]
}