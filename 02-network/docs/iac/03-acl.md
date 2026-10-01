# Tailscale IaC — acl.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

`acl.tf` manages the complete Tailnet ACL (Access Control List) 
policy via Terraform — the core Zero Trust enforcement layer. 
It defines who can reach what, over which ports, and who can 
SSH into which devices.

---

## Import Block

Tailscale creates a default allow-all ACL on every new Tailnet. 
Terraform must import this before managing it — otherwise apply 
errors with `precondition failed, invalid old hash`.

```hcl
import {
  to = tailscale_acl.policy
  id = "acl"
}
```

This block is safe to leave permanently — skipped on subsequent 
applies when resource is already in state. Applies to any Tailnet, 
fresh or pre-configured.

---

## Policy Structure

### Tag Ownership — `tagOwners`

Defines who can assign each tag to devices:

```hcl
tagOwners = {
  (var.tag_terraform)     = [var.admin_email]
  (var.tag_server)        = [var.tag_terraform]
  (var.tag_subnet_router) = [var.tag_terraform]
}
```

**The `tag:terraform` ownership chain:**

The OAuth client cannot generate auth keys for `tag:server` 
directly — Tailscale requires the OAuth client to own the tag 
it's assigning. `tag:terraform` is a manager tag:
OAuth client → assigned tag:terraform
tag:terraform → owns tag:server in ACLs
tag:terraform → owns tag:subnet-router in ACLs

This satisfies Tailscale's ownership requirement without giving 
the OAuth client direct ownership of infrastructure tags.

> **Reference:** This is a known Tailscale OAuth limitation 
> documented in GitHub issue #8299 and #15456.

---

### Grants — Network Access Rules

Tailscale is **default deny** — anything not listed is blocked. 
No deny rules needed.

| Source | Destination | Access |
|---|---|---|
| `admin_email` | `tag:server` | Full |
| `admin_email` | `tag:subnet-router` | Full |
| `admin_email` | `192.168.1.0/24` | Full |
| `admin_email` | `autogroup:internet` (exit nodes) | Full |
| `tag:server` | `192.168.1.0/24` | ❌ Blocked (implicit deny, deny-tested) |
| `tag:server` | `tag:subnet-router` | ❌ Blocked (implicit deny, deny-tested) |
| `tag:server` | user devices | ❌ Blocked (implicit deny) |
| `tag:subnet-router` | anywhere, including `tag:server` | ❌ Blocked (implicit deny, `tag:server` deny-tested) |

> **Removed grant:** earlier versions allowed `tag:server` → 
> `192.168.1.0/24` on all ports "for monitoring or backup", with no 
> real use case. The Azure VM is internet-facing, so that grant let 
> a compromised VM reach every port on every home LAN device. If a 
> real need appears, add a narrow grant (one host, one port) and 
> update the deny tests.

**Production expansion — multi-user groups:**
```json
"groups": {
  "group:itops":    ["will@company.com"],
  "group:sre":      ["alice@company.com"],
  "group:finance":  ["bob@company.com"]
},
"grants": [
  { "src": ["group:itops"],   "dst": ["tag:server"], "ip": ["*"] },
  { "src": ["group:sre"],     "dst": ["tag:server"], "ip": ["tcp:22","tcp:443"] },
  { "src": ["group:finance"], "dst": ["tag:payroll"], "ip": ["tcp:8443"] }
]
```

---

### SSH Rules

Identity-driven SSH — replaces password authentication:

```hcl
ssh = [
  {
    action = "accept"
    src    = [var.admin_email]
    dst    = [var.tag_server]
    users  = var.ssh_users      # e.g. ["tinyco-admin", "<linux-user>"], never root
  },
  {
    action      = "check"
    src         = [var.admin_email]
    dst         = [var.tag_server]
    users       = ["root"]
    checkPeriod = var.ssh_root_check_period   # default "12h"
  }
]
```

**Why two rules:** `accept` lets the admin in as an everyday user 
with no extra prompt. Root goes through `check`: Tailscale asks the 
admin to sign in again in the browser when the last check is older 
than `checkPeriod` (1m to 168h, default 12h). Tailscale evaluates 
`check` rules before `accept` rules 
([policy file syntax](https://tailscale.com/docs/reference/syntax/policy-file)). 
`ssh_users` is validated to never contain `root`, so root cannot 
slip in through the `accept` rule.

**Live effect:** root SSH that used to connect straight away now 
opens a browser re-authentication at most once per `checkPeriod`.

**IaC boundary:** The ACL SSH rule controls WHO can SSH. 
Enabling Tailscale SSH on the device (`sudo tailscale set --ssh`) 
is a manual prerequisite — the device-level CLI boundary.

**Production expansion:**
```json
"users": ["autogroup:nonroot"]
```
Maps Tailscale identity to matching Linux username automatically 
when IdP provisions Linux users via SCIM.

---

### Tests

Validates policy on every `terraform apply`: the save is rejected 
if any test fails. Accept tests prove the admin keeps access; deny 
tests prove the implicit denies stay in place.

```hcl
locals {
  home_test_ip = cidrhost(var.home_subnet_cidr, 1)   # 192.168.1.1 in this lab
}

tests = [
  {
    src    = var.admin_email
    accept = ["${var.tag_server}:22", "${var.tag_subnet_router}:80", "${local.home_test_ip}:80"]
    deny   = []
  },
  {
    src    = var.tag_server
    accept = []
    deny   = ["${local.home_test_ip}:80", "${local.home_test_ip}:22", "${var.tag_subnet_router}:22"]
  },
  {
    src    = var.tag_subnet_router
    accept = []
    deny   = ["${var.tag_server}:22"]
  }
]

sshTests = [
  {
    src    = var.admin_email
    dst    = [var.tag_server]
    accept = var.ssh_users
    check  = ["root"]
  }
]
```

> **Note:** Test accept values require `hostname:port` format — 
> not just hostname. Missing port = apply rejected with 
> `missing port in address` error.

> **Exit nodes are not tested.** The policy file reference documents 
> tests as `host:port` destinations and does not document 
> `autogroup:internet` as a test target, so there is no test for 
> the exit node grant.

---

## Official References

| Topic | URL |
|---|---|
| ACL policy syntax | https://tailscale.com/docs/reference/syntax/policy-file |
| Tags | https://tailscale.com/kb/1068/acl-tags |
| SSH rules | https://tailscale.com/kb/1193/tailscale-ssh |
| SSH `check`, `checkPeriod`, `sshTests` | https://tailscale.com/docs/reference/syntax/policy-file |
| Default deny | https://tailscale.com/blog/access-control-best-practices |
| OAuth tag ownership issue | https://github.com/tailscale/tailscale/issues/8299 |