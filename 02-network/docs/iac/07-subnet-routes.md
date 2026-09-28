# Tailscale IaC — subnet-routes.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  

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
  device_id  = data.tailscale_device.subnet_router_primary.id
  routes     = local.subnet_router_routes
  depends_on = [tailscale_acl.policy]
}

resource "tailscale_device_subnet_routes" "ha" {
  device_id  = data.tailscale_device.subnet_router_ha.id
  routes     = local.subnet_router_routes
  depends_on = [tailscale_acl.policy]
}
```

Both routers share one route set, defined once in `locals`
(see Exit Node Switch below).

**HA failover behaviour:**
- Tailscale selects one device as `PrimaryRoutes`
- If primary goes offline → automatic failover to secondary
- Failover time: ~15 seconds
- Zero client reconfiguration needed

**Verified in lab:**
Disabled primary route → pinged `192.168.1.254` from Azure VM 
→ 4/4 packets received via HA router. Failover confirmed ~5 seconds.

---

## Exit Node Switch

Both Apple TVs also act as exit nodes: a device that other
tailnet devices can send **all** their internet traffic
through, not just traffic for the home LAN.

In Tailscale, approving an exit node means approving two
special routes on the device:

| Route | Meaning |
|---|---|
| `0.0.0.0/0` | All IPv4 internet traffic |
| `::/0` | All IPv6 internet traffic |

These live in the same `tailscale_device_subnet_routes`
resource as the subnet route. That matters: if the code does
not list them, `terraform apply` treats any exit node approved
by hand in the admin console as drift and **removes it**.

One variable controls it for both routers:

```hcl
locals {
  exit_node_routes = ["0.0.0.0/0", "::/0"]

  subnet_router_routes = concat(
    [var.home_subnet_cidr],
    var.exit_node_enabled ? local.exit_node_routes : []
  )
}
```

```hcl
# terraform.tfvars
exit_node_enabled = true    # Apple TVs approved as exit nodes
exit_node_enabled = false   # home LAN subnet only
```

**Three things must all be true for an exit node to work:**

| Requirement | Where | Managed by |
|---|---|---|
| Device advertises itself as an exit node | Tailscale app on tvOS | Manual |
| Exit node routes approved | `subnet-routes.tf` via `exit_node_enabled` | Terraform |
| Users allowed to use exit nodes | `acl.tf` grant to `autogroup:internet` | Terraform |

> **Known boundary:** Exit nodes on personal devices (for
> example the engineer's Windows PC) are not managed here.
> Those devices carry no tags and are not in Terraform, so
> their exit node approval stays a manual admin console step.

### Who owns which step

Exit nodes involve three separate actions, and only one of
them belongs to Terraform:

| Where it happens | What it is | Does Terraform care? |
|---|---|---|
| **Client app** (phone, laptop): picking an exit node | **Using** an exit node. A personal choice on that device. | No. Nothing in the tailnet config changes, so there is no drift. |
| **Apple TV Tailscale app**: "Run as exit node" | **Advertising.** The device offers itself as an exit node. | No. Manual device step, outside the IaC boundary. |
| **Admin console**: approving or removing the exit node | **Approval.** | **Yes.** Terraform owns this. The next `terraform plan` shows a console change as drift, and `terraform apply` reverts it to match `exit_node_enabled`. |

> **Rule:** To turn exit nodes on or off, change
> `exit_node_enabled` in `terraform.tfvars` and run
> `terraform apply`. Never approve or remove them in the admin
> console. See [Code Is the Source of Truth](./00-IaC-Overview.md#code-is-the-source-of-truth).

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
| Exit nodes | https://tailscale.com/docs/features/exit-nodes |