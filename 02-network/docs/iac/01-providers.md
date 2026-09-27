# Tailscale IaC — providers.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://registry.terraform.io/providers/tailscale/tailscale/latest/docs

---

## Overview

`providers.tf` declares the Tailscale Terraform provider and 
configures API authentication via OAuth client credentials.

---

## Authentication Methods

The Tailscale provider supports three authentication methods:

| Method | Use case | Recommended |
|---|---|---|
| **OAuth client** | Tailnet-scoped, auto-rotating tokens | ✅ Production |
| **API access token** | Personal, short-lived | Development only |
| **Federated identity** | CI/CD with OIDC | Advanced |

**Why OAuth over API keys:**
OAuth clients are associated with the Tailnet — not an individual 
user. They support granular scopes, don't expire, and auto-rotate 
tokens. API keys are tied to a user account and expire after 90 days.

---

## Creating the OAuth Client

1. Go to **tailscale.com/admin/settings/oauth**
2. Click **Credential** → **OAuth**
3. Select scopes — all Write:
   - Devices → Core
   - Devices → Tags: `tag:server`, `tag:subnet-router`, `tag:terraform`
   - Devices → Routes
   - General → Policy File
   - General → DNS
   - Keys → Auth Keys: `tag:server`
   - Settings → Networking Settings
4. Click **Generate credential**
5. **Copy both Client ID and Secret immediately** — secret shown once only

> **Secret sprawl prevention:** OAuth credentials live only in 
> `terraform.tfvars` — gitignored, never committed to version 
> control. In production, inject via CI/CD environment variables 
> or a secrets manager (Azure Key Vault, HashiCorp Vault).

---

## Key Lessons Learned

**OAuth scope for auth key tags:**
Even with all scopes granted, Terraform cannot generate auth keys 
for tags unless the OAuth client explicitly has those tags assigned 
in the Tags section of the OAuth client config. This is separate 
from the ACL `tagOwners` definition — both must be configured.

**`tag:terraform` manager tag:**
The OAuth client cannot generate auth keys for `tag:server` directly 
unless it owns that tag. We use `tag:terraform` as a manager tag — 
the OAuth client is assigned `tag:terraform`, which owns `tag:server` 
in the ACL. This satisfies Tailscale's ownership chain requirement.

See: [03-acl.md](./03-acl.md) for the full tag ownership design.

---

## Official References

| Topic | URL |
|---|---|
| Provider documentation | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs |
| OAuth clients | https://tailscale.com/docs/features/oauth-clients |
| Authentication methods | https://tailscale.com/kb/1210/terraform-provider |