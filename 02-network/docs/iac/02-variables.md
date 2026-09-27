# Tailscale IaC — variables.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab

---

## Overview

`variables.tf` defines all input variables for the Tailscale 
Terraform configuration. Zero hardcoded values exist in any 
`.tf` logic file — all values are injected via `terraform.tfvars`.

---

## Zero Hardcode Design

This codebase follows the same zero-hardcode principle as the 
Entra IAM layer:

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

**Tailnet identity:**
- `tailnet` — Tailnet name (e.g. `hair-squeaker.ts.net`)

**Device DNS names:**
- `vm_DNSname` — full DNS name of Azure VM
- `subnet_router_primary_DNSname` — living room Apple TV DNS name
- `subnet_router_ha_DNSname` — bedroom Apple TV DNS name

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
- `home_subnet_cidr` — subnet advertised by Apple TV routers

**Identity:**
- `admin_email` — Tailscale account email for ACL grants

**Tags:**
- `tag_server` — tag for cloud infrastructure (default: `tag:server`)
- `tag_subnet_router` — tag for network infrastructure (default: `tag:subnet-router`)
- `tag_terraform` — manager tag for OAuth client (default: `tag:terraform`)

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