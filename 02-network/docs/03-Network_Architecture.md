# Tailscale Network Architecture

**Document Type:** Network Architecture Reference  
**Author:** Will Chang, Tailscale Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/docs

---

![Zero Trust IaC Network Architecture](../wshc_zero_trust_network_architecture.png)

## Overview

This document describes the full Zero Trust network architecture 
implemented in the WSHC lab — covering the Tailscale network 
layer, site-to-site topology, ACL policy design, and how it 
mirrors the Entra ID identity model.

For setup and troubleshooting procedures, see:
- [01-Tailscale_Subnet_Router_Setup_and_Troubleshooting.md](./01-Tailscale_Subnet_Router_Setup_and_Troubleshooting.md)
- [02-Tailscale_ACL_Tags_and_Access_Control.md](./02-Tailscale_ACL_Tags_and_Access_Control.md)

---

## Two-Layer Zero Trust Model

TinyCo's security architecture enforces Zero Trust at two 
independent layers:

| Layer | Tool | What it enforces |
|---|---|---|
| **Identity** | Microsoft Entra ID | Who can authenticate · SSO · MFA · RBAC |
| **Network** | Tailscale ACL | What authenticated devices can reach |

Neither layer trusts the other implicitly. A user must pass 
both identity verification (Entra ID → Tailscale SSO) AND 
network access control (Tailscale ACL policy) before reaching 
any resource.

---

## Network Topology

### Site A — Azure Cloud

| Property | Value |
|---|---|
| Location | Canada Central |
| Device | `tinyco-vm` — Ubuntu 24.04 |
| Tailscale IP | `100.93.4.6` |
| Tailscale tag | `tag:server` |
| SSH | Tailscale SSH — identity authenticated, no password |
| Port 22 | Closed via Azure NSG — public internet cannot reach |

---

## Azure VNet — Understanding the Cloud Network Layer

**VNet** (Virtual Network) is Azure's term for a 
**VPC (Virtual Private Cloud)** — a private, isolated network 
inside Azure that you define and control. Think of it as 
your office LAN, but hosted in the cloud.

### Why VNet Exists

Without a VNet, every Azure VM would be directly exposed to 
the public internet — no private network, no internal routing, 
no security boundary. A VNet gives you a private IP space, 
firewall control via NSG (Network Security Group), and 
isolation from other Azure customers.

### Lab VNet Layout

When `tinyco-vm` was deployed, Azure automatically placed it 
inside a VNet:
Azure Cloud
└── VNet — 10.0.0.0/24
└── tinyco-vm
├── Private IP: 10.0.0.4 (internal, VNet only)
└── Public IP:  20.63.73.34 (internet-facing, port 22 closed)

This is visible in the VM's routing table:

```bash
ip route show

# Output:
default via 10.0.0.1 dev eth0       ← Azure internet gateway
10.0.0.0/24 dev eth0                ← VNet private subnet
```

The `10.0.0.0/24` is the VNet subnet. The VM lives inside 
it with a private IP of `10.0.0.4`.

### RFC 1918 — Private IP Ranges

VNet IP ranges follow **RFC 1918** — the internet standard 
for private network addresses. These ranges are reserved and 
never appear on the public internet:

| Range | Common use |
|---|---|
| `10.0.0.0/8` | Large enterprise networks, cloud VPCs |
| `172.16.0.0/12` | Mid-size networks, Docker default |
| `192.168.0.0/16` | Home networks, small offices |

> **Lab comparison:** Your home LAN uses `192.168.1.0/24` 
> (RFC 1918). Azure VNet uses `10.0.0.0/24` (RFC 1918). 
> Tailscale uses `100.64.0.0/10` — a separate reserved range 
> called CGNAT, purpose-built for overlay networks like 
> Tailscale's mesh.

### VNet vs Home LAN vs Tailscale

| | Home LAN | Azure VNet | Tailscale |
|---|---|---|---|
| **Location** | Physical router | Azure cloud | Virtual overlay — anywhere |
| **Private IP range** | `192.168.1.0/24` | `10.0.0.0/24` | `100.x.x.x` |
| **Controls it** | ASUS router / Telus modem | Azure portal / Terraform NSG | Tailscale ACL policy |
| **Internet access** | Via Telus modem | Via Azure internet gateway | Via exit node |
| **Connects to Tailscale** | Via Apple TV subnet router | VM is direct Tailnet member | Native |
| **Firewall** | Router rules | NSG inbound/outbound rules | ACL policy |

### Production VNet Design

In a production environment, a VNet would be segmented into 
multiple subnets — each with its own NSG rules and access 
controls:
Azure VNet (10.0.0.0/16)
├── Web subnet      (10.0.1.0/24) — public-facing, port 443 open
├── Database subnet (10.0.2.0/24) — no internet, internal only
└── Admin subnet    (10.0.3.0/24) — Tailscale SSH only, port 22 closed

Tailscale bridges all of these — engineers SSH directly into 
the admin subnet via Tailscale identity, databases stay 
completely private, web servers remain public. Zero Trust 
enforced at every layer.

> **Key insight:** The Azure VNet is the cloud equivalent of 
> your home LAN. Both are private networks sitting behind a 
> gateway, with firewall rules controlling what comes in and 
> out. Tailscale connects them transparently — without opening 
> ports, without a traditional VPN, and without exposing 
> private IP ranges to the internet.

### Official References

| Topic | URL |
|---|---|
| Azure VNet overview | https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview |
| RFC 1918 private ranges | https://datatracker.ietf.org/doc/html/rfc1918 |
| Azure NSG | https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview |
| Tailscale CGNAT range | https://tailscale.com/blog/how-tailscale-works#cgnat-address-space |

Put it right under the VNet section — it flows naturally there since you just introduced the IP ranges in the table. Reading order becomes:
VNet section → explains 10.0.0.0/24
    ↓
RFC 1918 section → explains WHY that range exists
    ↓
Reader fully understands the network addressing story
Here's the section:
markdown---

## RFC 1918 — Private IP Addressing Explained

When you see IP addresses like `10.0.0.4`, `192.168.1.254`, 
or `172.17.0.0` — these are **private IP addresses** defined 
by **RFC 1918** (Request for Comments 1918), the internet 
standard published by IETF (Internet Engineering Task Force) 
that reserves specific IP ranges exclusively for private 
networks.

These ranges are guaranteed to never appear on the public 
internet — routers on the internet are configured to drop 
packets with RFC 1918 source or destination addresses. This 
makes them safe to reuse across millions of private networks 
without conflict.

### The Three RFC 1918 Ranges

| Range | Size | Common use |
|---|---|---|
| `10.0.0.0/8` | ~16 million addresses | Large enterprise networks, cloud VPCs |
| `172.16.0.0/12` | ~1 million addresses | Mid-size networks, Docker default |
| `192.168.0.0/16` | ~65,000 addresses | Home networks, small offices |

> **Why so many addresses?** Large organisations like 
> hospitals, universities, and cloud providers need thousands 
> of internal IP addresses. `10.0.0.0/8` gives ~16 million — 
> enough for even the largest enterprise. Home networks only 
> need a few dozen, so `192.168.x.x` is sufficient.

### How This Appears in Our Lab

Every network in the lab uses RFC 1918 ranges:

| Network | Range | RFC 1918 block |
|---|---|---|
| Azure VNet | `10.0.0.0/24` | `10.0.0.0/8` |
| Docker internal | `172.17.0.0/16` | `172.16.0.0/12` |
| Home LAN | `192.168.1.0/24` | `192.168.0.0/16` |
| Tailscale | `100.64.0.0/10` | CGNAT — separate standard |

### Tailscale's Special Range — CGNAT

Tailscale uses `100.64.0.0/10` — a range defined by a 
different standard called **CGNAT (Carrier-Grade NAT)**, 
originally reserved for ISPs. Tailscale chose this range 
deliberately because:

- It is not RFC 1918 — so it doesn't conflict with common 
  corporate or home network ranges
- It is not routable on the public internet
- It is unlikely to be used by any existing private network

This is why every Tailscale device gets a `100.x.x.x` IP — 
it is Tailscale's own private overlay network address space, 
separate from your home LAN or cloud VPC.

```bash
# All three private ranges visible in our lab at once:
tailscale status
# 100.93.4.6  tinyco-vm     ← Tailscale CGNAT range

ip route show  # on Azure VM
# 10.0.0.0/24 dev eth0      ← Azure VNet RFC 1918
# 172.17.0.0/16 dev docker0 ← Docker RFC 1918

# Home network
# 192.168.1.0/24            ← Home LAN RFC 1918
```

### Why This Matters for Subnet Routing

Understanding RFC 1918 ranges is essential for subnet router 
configuration — you must advertise the correct private range:

```bash
# Correct — advertises the actual home LAN range
sudo tailscale set --advertise-routes=192.168.1.0/24

# Wrong — advertising a public IP range would be blocked
sudo tailscale set --advertise-routes=8.8.8.0/24
```

> **Interview tip:** When a customer says "my subnet router 
> isn't working" — always confirm they are advertising a 
> valid RFC 1918 range, not a public IP range or an 
> overlapping range that conflicts with another subnet.

### Official References

| Topic | URL |
|---|---|
| RFC 1918 standard | https://datatracker.ietf.org/doc/html/rfc1918 |
| Tailscale CGNAT range | https://tailscale.com/blog/how-tailscale-works#cgnat-address-space |
| Tailscale IP addressing | https://tailscale.com/kb/1015/100.x-addresses |
| Docker networking | https://docs.docker.com/network/ |

### Site B — Home LAN

| Property | Value |
|---|---|
| Subnet | `192.168.1.0/24` |
| Tailscale tag | `tag:subnet-router` |
| Primary router | `iwilltvliving` — Apple TV, ethernet, `100.109.140.74` |
| HA router | `iwilltvmaster` — Apple TV, WiFi, `100.122.120.115` |
| Gateway | `192.168.1.254` — Telus fibre modem |
| AP | `192.168.1.59` — ASUS router (AP mode) |

### Engineer Devices

| Device | Tailscale name | Identity |
|---|---|---|
| Windows PC | `iwillwindows` | `will.sh.chang@gmail.com` |
| iPad Pro | `iwill14pro` | `will.sh.chang@gmail.com` |
| iPhone | `iwillprom4` | `will.sh.chang@gmail.com` |

---

## Tailscale SSH Architecture

### Before Tailscale SSH
Engineer → public internet → port 22 open → password auth → VM

Weaknesses:
- Port 22 exposed to the internet
- Password-based authentication
- No identity correlation
- No audit trail in Tailscale

### After Tailscale SSH
Engineer → Tailscale identity (Entra SSO) → ACL validates →
Tailscale intercepts SSH → VM (no open ports)

Improvements:
- Port 22 closed to public internet via Azure NSG
- Authentication via Tailscale identity — no password
- ACL policy controls who can SSH to what
- Full SSH session audit trail in Tailscale admin console
- Browser-based re-authentication available (`action: check`)

### SSH ACL Rule

```json
"ssh": [
    {
        "action": "accept",
        "src":    ["will.sh.chang@gmail.com"],
        "dst":    ["tag:server"],
        "users":  ["tinyco-admin", "iwill", "root"]
    }
]
```

---

## Site-to-Site Architecture

### How it works
Azure VM (Site A, 100.93.4.6)
↓ Tailscale encrypted tunnel
Apple TV subnet router (Site B, 100.109.140.74)
↓ SNAT — rewrites source IP
192.168.1.0/24 home LAN
→ 192.168.1.254 (Telus modem)
→ 192.168.1.59 (ASUS AP)
→ Any non-Tailscale device on the subnet

### Connection type

Traffic between Azure VM and Apple TV travels via DERP 
(Detoured Encrypted Routing Protocol) Seattle relay due to 
double NAT (Telus modem + ASUS AP mode). Traffic remains 
end-to-end encrypted — DERP only sees encrypted packets.

Typical latency:
- First packet: `~300ms` (DERP relay negotiation)
- Subsequent: `~75-85ms` (path optimised)

### SNAT behaviour

By default Tailscale uses SNAT (Source Network Address 
Translation) on subnet traffic. Devices on the home LAN see 
traffic as originating from the Apple TV's LAN IP — not the 
Azure VM's Tailscale IP.

---

## High Availability Subnet Routing

Two Apple TVs advertise the same `192.168.1.0/24` subnet:
iwilltvliving (primary, ethernet) ─── 192.168.1.0/24
iwilltvmaster (standby, WiFi)    ─── 192.168.1.0/24

Tailscale selects `iwilltvliving` as primary (lower latency 
via ethernet). If primary goes offline, Tailscale automatically 
fails over to `iwilltvmaster` — zero client configuration 
required.

**HA failover verified:**
Disabled primary subnet route in admin console → pinged 
`192.168.1.254` from Azure VM → 4/4 packets received via 
secondary Apple TV. Failover time: ~5 seconds.

**Verify active primary:**
```bash
tailscale status --json | python3 -c "
import json,sys
data=json.load(sys.stdin)
for peer in data.get('Peer',{}).values():
    routes=peer.get('PrimaryRoutes',[])
    if routes:
        print(peer['HostName'], routes)
"
```

---

## ACL Policy Design

### Design principle

> Identity drives access, tags define infrastructure roles. 
> ACL rules mirror the Entra ID RBAC model — one source of 
> truth for roles, two enforcement layers.

### Tag model

| Tag | Assigned to | Represents |
|---|---|---|
| `tag:server` | `tinyco-vm` | Cloud infrastructure |
| `tag:subnet-router` | Both Apple TVs | Network infrastructure |

User devices carry no tags — identified by Tailscale identity 
(`will.sh.chang@gmail.com`) which maps back to Entra ID via SSO.

### Access matrix

| Source | Destination | Access |
|---|---|---|
| `will.sh.chang@gmail.com` | `tag:server` | ✅ Full |
| `will.sh.chang@gmail.com` | `tag:subnet-router` | ✅ Full |
| `will.sh.chang@gmail.com` | `192.168.1.0/24` | ✅ Full |
| `tag:server` | `192.168.1.0/24` | ✅ Full |
| `tag:server` | user devices | ❌ Blocked (implicit deny) |
| `tag:subnet-router` | anywhere | ❌ Blocked (implicit deny) |
| anything else | anything else | ❌ Blocked (implicit deny) |

### Entra ID mirror (production design)

In a multi-user production tailnet, Tailscale groups would 
mirror Entra ID dynamic groups exactly:

```json
"groups": {
    "group:itops":    ["itops-member@company.com"],
    "group:sre":      ["sre-member@company.com"],
    "group:backend":  ["backend-member@company.com"]
},
"grants": [
    {
        "src": ["group:itops"],
        "dst": ["tag:server", "tag:subnet-router", "10.0.0.0/8"],
        "ip":  ["*"]
    },
    {
        "src": ["group:sre"],
        "dst": ["tag:server"],
        "ip":  ["tcp:22", "tcp:443"]
    },
    {
        "src": ["group:backend"],
        "dst": ["tag:server"],
        "ip":  ["tcp:443"]
    }
]
```

Same roles defined once in Entra ID, enforced at both identity 
and network layers.

---

## Linux-Specific Behaviour

Unlike Windows, macOS, iOS, and tvOS — Linux devices do not 
automatically accept advertised subnet routes. Explicit opt-in 
required:

```bash
sudo tailscale set --accept-routes
```

This is intentional security design — a rogue subnet router 
cannot inject routes into a Linux device without explicit 
consent.

---

## Production Enhancements

### Terraform IaC for ACL policy

```hcl
resource "tailscale_acl" "policy" {
  acl = jsonencode({
    tagOwners = {
      "tag:server"        = ["will.sh.chang@gmail.com"]
      "tag:subnet-router" = ["will.sh.chang@gmail.com"]
    }
    grants = [
      {
        src = ["will.sh.chang@gmail.com"]
        dst = ["tag:server"]
        ip  = ["*"]
      }
    ]
    ssh = [
      {
        action = "accept"
        src    = ["will.sh.chang@gmail.com"]
        dst    = ["tag:server"]
        users  = ["tinyco-admin", "iwill"]
      }
    ]
  })
}
```

### Direct P2P connection

Current DERP relay latency (~75ms) is acceptable for the lab. 
To establish direct P2P connection, enable UDP port forwarding 
on the Telus modem for port `41641` pointing to Apple TV LAN IP.

Note: This requires manual router configuration and partially 
defeats Tailscale's zero-configuration value proposition. 
DERP relay is the recommended approach for consumer network 
environments.

### SSH session recording

Tailscale SSH supports session recording — every SSH session 
captured and stored for audit. Requires Tailscale Enterprise 
plan.

```json
"ssh": [
    {
        "action": "accept",
        "src":    ["will.sh.chang@gmail.com"],
        "dst":    ["tag:server"],
        "users":  ["tinyco-admin"],
        "recordingTargets": ["tag:logging-server"]
    }
]
```

---

## Official References

| Topic | URL |
|---|---|
| Subnet routers | https://tailscale.com/docs/features/subnet-routers |
| Tailscale SSH | https://tailscale.com/docs/features/tailscale-ssh |
| ACL policy syntax | https://tailscale.com/docs/reference/syntax/policy-file |
| Tags | https://tailscale.com/kb/1068/acl-tags |
| HA subnet routing | https://tailscale.com/docs/how-to/set-up-high-availability |
| Site-to-site | https://tailscale.com/docs/features/site-to-site |
| DERP relay | https://tailscale.com/blog/how-tailscale-works |