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
# On the VM console
sudo tailscale up
# Opens browser URL → human must authenticate manually
# Cannot be scripted or automated at scale
```

**With auth key (no browser login):**
```bash
# On the VM (root-only file, key never on a command line)
sudo tailscale up --auth-key=file:/root/ts-authkey --ssh
# VM joins the tailnet as tag:server in seconds
```

See [Enrolling the VM](#enrolling-the-vm) for the full steps.

---

## Key Design

```hcl
resource "tailscale_tailnet_key" "vm_auth_key" {
  reusable      = false   # single-use — limits blast radius
  ephemeral     = false   # VM persists after going offline
  preauthorized = true    # pre-approves the device IF device approval is on
  expiry        = 3600    # expires in 1 hour — use immediately
  description   = "Terraform auth key for tinyco-vm"
  tags          = [var.tag_server]
  depends_on    = [tailscale_acl.policy]
}
```

**`reusable = false`** — single-use key. If leaked, attacker can 
only enroll one device before the key is consumed.

**`preauthorized = true`**: only has an effect when device 
approval is turned on (`devices_approval_on` in 
`tailnet_settings.tf`, currently off). Then a device that enrolls 
with this key skips the manual approval step. With device approval 
off, every device is approved anyway.

**`expiry = 3600`** — 1 hour expiry. Use immediately after 
`terraform apply`.

**After first use or expiry:** a single-use key becomes invalid 
once a device enrolls with it, or after the hour passes. Terraform 
keeps the invalid key in state and a plain `terraform apply` does 
**not** create a new one (provider docs for `recreate_if_invalid`: 
"By default, reusable keys will be recreated, but single-use keys 
will not."). To mint a fresh key:

```bash
terraform apply -replace=tailscale_tailnet_key.vm_auth_key
```

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

## Enrolling the VM

**1. Read the key on the admin machine** (where Terraform runs, in 
`02-network/terraform`; Terraform state is not on the VM):

```bash
terraform output -raw vm_auth_key
```

Key value starts with `tskey-auth-...`

**2. Open a console on the VM that does not use port 22**, for 
example Azure Serial Console. Port 22 is closed at the NSG, so 
plain `ssh` to the VM is not an option, and Tailscale SSH only works 
after the VM has joined.

**3. On the VM, pass the key from a root-only file:**

```bash
sudo install -m 600 /dev/null /root/ts-authkey
sudo nano /root/ts-authkey          # paste the key, save
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=file:/root/ts-authkey --ssh
sudo shred -u /root/ts-authkey
```

The `file:` prefix is documented for `--auth-key`: "if it begins 
with "file:", then it's a path to a file containing the authkey" 
([tailscale up](https://tailscale.com/kb/1241/tailscale-up)). The 
key never appears on a command line, so it stays out of shell 
history and the process list.

**Not on the VM:** `--advertise-exit-node` (the VM is not an exit 
node; exit nodes are the Apple TVs, see `subnet-routes.tf`) and 
`--accept-routes` (the ACL gives `tag:server` no access to the home 
subnet).

**Security: secret sprawl prevention:**
The output is marked `sensitive = true`, so it is never printed in plain 
text during `terraform plan` or `terraform apply`. Never paste the 
key into a command line, a chat, or a committed file. In production, 
store it in a secrets manager (Azure Key Vault, HashiCorp Vault) and 
deliver it to the VM through cloud-init or the secrets manager.

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
| `tailscale up --auth-key` | https://tailscale.com/kb/1241/tailscale-up |
| Auth keys (features) | https://tailscale.com/docs/features/access-control/auth-keys |
| Tailnet key resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_key |
| OAuth tag ownership | https://github.com/tailscale/tailscale/issues/8299 |
| Tag owners syntax | https://tailscale.com/docs/reference/syntax/policy-file#tag-owners |
| Tags and ownership | https://tailscale.com/docs/features/tags#ownership |