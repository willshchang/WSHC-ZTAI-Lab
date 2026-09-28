# Tailscale IaC — keys.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

`keys.tf` generates pre-authentication keys via Terraform — allowing 
devices to join the Tailnet without manual browser login.

---

## Auth Key vs Tailscale SSH — Two Different Things

A common misconception is that Tailscale SSH and auth keys are 
related. They are completely separate:

| Feature | Purpose | When used |
|---|---|---|
| **Auth key** | Device enrollment — joins Tailnet | One time — bootstrap |
| **Tailscale SSH** | Ongoing SSH access — replaces passwords | Every SSH session |

**Auth key** = the employee badge that gets you in the building  
**Tailscale SSH** = your ID card that controls which rooms you access

---

## Why Auth Keys Matter for IaC

**Without auth key — manual enrollment:**
```bash
ssh admin@vm
sudo tailscale up
# Opens browser URL → human must authenticate manually
# Cannot be scripted or automated at scale
```

**With auth key — fully automated:**
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up \
  --authkey=$(terraform output -raw vm_auth_key) \
  --ssh \
  --accept-routes \
  --advertise-exit-node
# No browser, no human, VM joins Tailnet in seconds
```

---

## Key Design

```hcl
resource "tailscale_tailnet_key" "vm_auth_key" {
  reusable      = false   # single-use — limits blast radius
  ephemeral     = false   # VM persists after going offline
  preauthorized = true    # skips manual approval in admin console
  expiry        = 3600    # expires in 1 hour — use immediately
  description   = "Tailscale auth key for tinyco-vm"
  tags          = [var.tag_server]
  depends_on    = [tailscale_acl.policy]
}
```

**`reusable = false`** — single-use key. If leaked, attacker can 
only enroll one device before the key is consumed.

**`expiry = 3600`** — 1 hour expiry. Use immediately after 
`terraform apply`. Expired keys cannot be used — generate a new 
one by running `terraform apply` again.

---

## The `tag:terraform` Ownership Chain

**The problem:**
The OAuth client cannot generate auth keys for `tag:server` unless 
it owns that tag. But ownership cannot be assigned directly from 
the OAuth client to `tag:server` — Tailscale requires a declared 
manager tag as the intermediary.

**The solution — manager tag pattern:**
```
admin_email → owns → tag:terraform (declared in tagOwners)
tag:terraform → owns → tag:server (declared in tagOwners)
tag:terraform → owns → tag:subnet-router (declared in tagOwners)
OAuth client → assigned → tag:terraform (admin console)
```

The OAuth client is assigned `tag:terraform` in the admin console. 
`tag:terraform` owns `tag:server` and `tag:subnet-router` via 
`tagOwners` in `acl.tf`. This gives Terraform the authority to 
generate auth keys for infrastructure tags through an unbroken 
ownership chain.

> **Analogy — gym franchise:**  
> Think of it like a gym franchise. Corp wants to open 10 new 
> branches without dispatching corporate staff to each one. They 
> hire a licensed contractor — but the contractor can only issue 
> official location tags if Corp has credentialed them first.  
> `admin_email` is Corp. `tag:terraform` is the credentialed 
> contractor. `tag:server` is the location tag. Without the 
> credential chain declared upfront, the enrollment is rejected — 
> the branch can't open under the brand.

> **Known Tailscale OAuth limitation:**  
> https://github.com/tailscale/tailscale/issues/8299  
> https://github.com/tailscale/tailscale/issues/15456

---

## Retrieving the Key

```bash
# After terraform apply
terraform output -raw vm_auth_key
```

Key value starts with `tskey-auth-...`

**Security — secret sprawl prevention:**
The output is marked `sensitive = true` — never printed in plain 
text during `terraform plan` or `terraform apply`. Always retrieve 
via `terraform output -raw` and pipe directly — never store in 
plain text files or shell history.

**Production pattern:**
```bash
# Pipe directly without storing
sudo tailscale up --authkey=$(terraform output -raw vm_auth_key) --ssh
```

---

## Production Expansion

```hcl
# CI/CD ephemeral node — auto-removed when offline
resource "tailscale_tailnet_key" "ci_key" {
  reusable      = true
  ephemeral     = true    # removed from Tailnet after going offline
  preauthorized = true
  expiry        = 3600
  description   = "CI/CD ephemeral key"
  tags          = [var.tag_server]
}

# Separate keys per environment
resource "tailscale_tailnet_key" "prod_key" {
  description = "Production server key"
  tags        = ["tag:prod-server"]
}

resource "tailscale_tailnet_key" "staging_key" {
  description = "Staging server key"
  tags        = ["tag:staging-server"]
}
```

---

## Official References

| Topic | URL |
|---|---|
| Auth keys | https://tailscale.com/kb/1085/auth-keys |
| Auth keys (features) | https://tailscale.com/docs/features/access-control/auth-keys |
| Tailnet key resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_key |
| OAuth tag ownership | https://github.com/tailscale/tailscale/issues/8299 |
| Tag owners syntax | https://tailscale.com/docs/reference/syntax/policy-file#tag-owners |
| Tags and ownership | https://tailscale.com/docs/features/tags#ownership |