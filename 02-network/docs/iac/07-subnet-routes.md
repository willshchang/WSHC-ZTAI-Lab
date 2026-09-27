# Tailscale IaC — subnet-routes.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_subnet_routes

---

## Overview

`subnet-routes.tf` approves subnet routes advertised by enrolled 
devices — the IaC step in the subnet router setup process.

---

## IaC Boundary

| Step | Method |
|---|---|
| Advertise subnet on Apple TV | Manual — Tailscale app → Settings |
| Advertise subnet on Linux | Manual — `sudo tailscale set --advertise-routes=192.168.1.0/24` |
| **Approve subnet route** | **Terraform** ✅ |
| Accept routes on Linux client | Manual — `sudo tailscale set --accept-routes` |

**Why approval matters:**
A rogue subnet router cannot hijack Tailnet traffic without explicit 
admin approval — this is Zero Trust at the network routing layer.

---

## Data Sources

Device data sources are defined in `tags.tf` and shared across 
the module — no need to redefine here:

```hcl
# Devices referenced from tags.tf:
# data.tailscale_device.subnet_router_primary
# data.tailscale_device.subnet_router_ha
```

---

## HA Subnet Router Design

Both Apple TVs advertise the same `192.168.1.0/24` subnet:

```hcl
resource "tailscale_device_subnet_routes" "primary" {
  device_id = data.tailscale_device.subnet_router_primary.id
  routes    = [var.home_subnet_cidr]
  depends_on = [tailscale_acl.policy]
}

resource "tailscale_device_subnet_routes" "ha" {
  device_id = data.tailscale_device.subnet_router_ha.id
  routes    = [var.home_subnet_cidr]
  depends_on = [tailscale_acl.policy]
}
```

**HA failover behaviour:**
- Tailscale selects one device as `PrimaryRoutes`
- If primary goes offline → automatic failover to secondary
- Failover time: ~15 seconds
- Zero client reconfiguration needed

**Verified in lab:**
Disabled primary route → pinged `192.168.1.254` from Azure VM 
→ 4/4 packets received via HA router. Failover confirmed ~5 seconds.

---

## Production Expansion

Different subnets per site:
```hcl
# HQ subnet router
resource "tailscale_device_subnet_routes" "hq" {
  device_id = data.tailscale_device.hq_router.id
  routes    = ["192.168.1.0/24"]
}

# Branch subnet router
resource "tailscale_device_subnet_routes" "branch" {
  device_id = data.tailscale_device.branch_router.id
  routes    = ["10.10.0.0/24"]
}
```

---

## Official References

| Topic | URL |
|---|---|
| Subnet routes resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_subnet_routes |
| Subnet routers | https://tailscale.com/docs/features/subnet-routers |
| HA subnet routing | https://tailscale.com/docs/how-to/set-up-high-availability |