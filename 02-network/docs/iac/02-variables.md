# Tailscale IaC — variables.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

`variables.tf` defines all input variables for the Tailscale 
Terraform configuration. Zero hardcoded values exist in any 
`.tf` logic file — all values are injected via `terraform.tfvars`.

---

## Zero Hardcode Design

This codebase follows the same zero-hardcode principle as the 
identity layer:

> No device IDs, email addresses, subnet CIDRs, or credentials 
> exist in any `.tf` file. Swap `terraform.tfvars` and the 
> same code deploys to any Tailnet.

This makes the codebase fully portable and safe to commit to 
public version control — no sensitive data ever touches GitHub.

---

## Variable Groups

**Authentication:**
- `oauth_client_id` — Tailscale OAuth client ID
- `oauth_client_secret` — Tailscale OAuth client secret

There is no `tailnet` variable: the provider manages the tailnet 
that owns the OAuth client.

**Device DNS names** (full MagicDNS name, e.g. 
`tinyco-vm.<tailnet>.ts.net`, not the short hostname):
- `vm_DNSname`: full DNS name of the Azure VM
- `subnet_router_primary_DNSname`: full DNS name of the primary Apple TV
- `subnet_router_ha_DNSname`: full DNS name of the HA Apple TV

> **Important — DNS name vs hostname:**  
> Some devices (Apple TV, iPhone) return generic hostnames like 
> `apple-tv` via the Tailscale API. Always use the full DNS name 
> instead. Find it by running:
> ```bash
> tailscale status --json | python3 -c "
> import json,sys
> data=json.load(sys.stdin)
> for peer in data.get('Peer',{}).values():
>     print('HostName:', peer['HostName'])
>     print('DNSName:', peer.get('DNSName',''))
>     print('---')
> "
> ```

**Network:**
- `home_subnet_cidr`: subnet advertised by Apple TV routers. Validated as a CIDR block. The ACL tests use its first host (`cidrhost(home_subnet_cidr, 1)`, the modem in this lab)
- `exit_node_enabled`: true/false switch approving both Apple TV routers as exit nodes (see [07-subnet-routes.md](./07-subnet-routes.md))

**Identity:**
- `admin_email`: the admin's Tailscale login, used in ACL grants and SSH rules
- `ssh_users`: non-root Linux users the admin may log in as over Tailscale SSH (kept out of the code so no real usernames are published). Validated to never contain `root`
- `ssh_root_check_period`: how long a browser re-authentication for root SSH stays valid (default `12h`; Tailscale allows 1m to 168h)

**Tags** (each validated to start with `tag:`):
- `tag_server`: tag for cloud infrastructure (default: `tag:server`)
- `tag_subnet_router`: tag for network infrastructure (default: `tag:subnet-router`)
- `tag_terraform`: manager tag for OAuth client (default: `tag:terraform`)

**Upgrading an existing `terraform.tfvars`:** remove `"root"` from 
`ssh_users` (plan fails otherwise) and delete the old `tailnet` line 
(Terraform warns about an undeclared variable).

---

## terraform.tfvars Setup

```bash
cp terraform.tfvars.example terraform.tfvars
```

Fill in real values — this file is gitignored and never committed.

---

## Official References

| Topic | URL |
|---|---|
| Terraform input variables | https://developer.hashicorp.com/terraform/language/values/variables |
| Sensitive variables | https://developer.hashicorp.com/terraform/language/values/variables#suppressing-values-in-cli-output |