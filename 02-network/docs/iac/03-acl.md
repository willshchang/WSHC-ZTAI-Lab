# Tailscale IaC — acl.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/docs/reference/syntax/policy-file

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
  "tag:terraform"         = [var.admin_email]
  (var.tag_server)        = ["tag:terraform"]
  (var.tag_subnet_router) = ["tag:terraform"]
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
| `tag:server` | `192.168.1.0/24` | Full |
| `tag:server` | user devices | ❌ Blocked (implicit deny) |
| `tag:subnet-router` | anywhere | ❌ Blocked (implicit deny) |

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
    users  = ["tinyco-admin", "iwill", "root"]
  }
]
```

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

Validates policy on every `terraform apply` — save rejected if 
any test fails:

```hcl
tests = [
  {
    src    = var.admin_email
    accept = ["tag:server:22", "tag:subnet-router:80", "192.168.1.1:80"]
    deny   = []
  }
]
```

> **Note:** Test accept values require `hostname:port` format — 
> not just hostname. Missing port = apply rejected with 
> `missing port in address` error.

---

## Official References

| Topic | URL |
|---|---|
| ACL policy syntax | https://tailscale.com/docs/reference/syntax/policy-file |
| Tags | https://tailscale.com/kb/1068/acl-tags |
| SSH rules | https://tailscale.com/kb/1193/tailscale-ssh |
| Default deny | https://tailscale.com/blog/access-control-best-practices |
| OAuth tag ownership issue | https://github.com/tailscale/tailscale/issues/8299 |