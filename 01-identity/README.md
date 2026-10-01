# Layer 1: Identity (Microsoft Entra ID)

**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

The identity layer of the WSHC ZTAI Lab: enterprise-grade Microsoft Entra ID 
(formerly Azure Active Directory) identity infrastructure, built entirely 
with Terraform IaC (Infrastructure as Code) and secured with a Zero Trust network architecture.

This layer controls **Accessibility**: who can access what. Every
user, group, role and app assignment is decided here.

It simulates a real-world identity migration for TinyCo — a 
fictional 90-person company — covering the full identity lifecycle from 
HR data ingestion to automated user provisioning, SSO across multiple 
SaaS platforms, and network-level Zero Trust enforcement via Tailscale.

---

## What This Lab Demonstrates

| Capability | Implementation |
|---|---|
| **Infrastructure as Code** | Terraform — full Entra ID environment deployable in under 5 minutes |
| **Zero Trust Architecture** | Two-layer model — Tailscale gates infrastructure, Entra SSO gates SaaS |
| **Dynamic Identity** | ABAC (Attribute-Based Access Control) via Entra dynamic groups |
| **Self-Healing Provisioning** | HR CSV → ETL pipeline → Terraform → Entra → auto group assignment |
| **SSO Integrations** | SAML + OIDC across Tailscale, Mattermost, Tableau, Elastic |
| **SCIM Provisioning** | Automated user lifecycle management via Tableau SCIM |
| **Security Model** | Conditional Access (MFA, legacy auth block), break-glass account, least privilege RBAC. See [Licensing](#licensing-what-needs-entra-id-p1) for what is live on the current Free tenant |
| **Linux Administration** | Azure VM, Docker, Tailscale VPN, SSH hardening |

---

## Architecture

### Zero Trust — Two Layers

**Layer 1 — Identity (Entra ID SSO)**  
Cloud SaaS applications (Tableau, Elastic) are protected by Entra ID 
SSO via SAML or OIDC. Only users and groups assigned to an app can 
get a token for it. MFA was enforced on every sign-in via 
Conditional Access while the tenant had E5; the policies still 
exist but are frozen on the current Free tier (see 
[Licensing](#licensing-what-needs-entra-id-p1)).

**Layer 2 — Network (Tailscale)**  
Internal resources (Azure VM, Mattermost) are unreachable from the 
public internet. SSH port 22 is closed. Access requires an active 
Tailscale connection. Today the tailnet admin signs in to Tailscale 
with a personal identity provider, not Entra ID, so Entra 
Conditional Access and MFA do not gate the tailnet yet. Moving the 
tailnet to Entra ID as its identity provider is a planned step.

![Security Architecture](../docs/diagrams/tinyco_security_architecture.png)

### Identity Journey

From HR data to app access — fully automated:

![Identity Journey](../docs/diagrams/tinyco_identity_journey.png)

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Identity** | Microsoft Entra ID (built and validated on an E5 trial; Free tier since the trial ended) |
| **IaC** | Terraform (azuread + azurerm providers) |
| **Network** | Tailscale (Zero Trust VPN, exit node) |
| **VM** | Azure (Ubuntu 24.04, Standard B2s, Canada Central) |
| **Chat** | Mattermost (Docker Compose + Postgres 15, SAML SSO) |
| **Analytics** | Tableau Cloud (SAML SSO + SCIM provisioning) |
| **Observability** | Elastic Cloud — Kibana (SAML SSO) |
| **Scripting** | Bash (ETL pipeline, gallery lookup) |
| **Version Control** | GitHub |

---

## Repository Structure
```
01-identity/
│
├── README.md
├── scripts/
│   ├── 00-hr-data-etl.sh        ← HR data pipeline (run before terraform)
│   └── 01-gallery-lookup.sh     ← Microsoft gallery app search utility
│
├── terraform/
│   ├── providers.tf              ← Azure + Entra provider config
│   ├── variables.tf              ← Variable definitions (zero hardcoded values)
│   ├── terraform.tfvars         ← Values (gitignored)
│   ├── users.tf                  ← CSV-driven users, roster guard, break-glass account + Global Admin
│   ├── groups.tf                 ← Dynamic ABAC groups + static admin groups
│   ├── jml.tf                    ← Static groups for the JML agent (Layer 3)
│   ├── rbac.tf                   ← Role assignments + app access matrix
│   ├── conditional-access.tf     ← MFA + legacy auth policies
│   ├── tailscale.tf              ← Tailscale app reference
│   ├── mattermost.tf             ← Mattermost SAML registration
│   ├── tableau.tf                ← Tableau SAML registration
│   ├── elastic.tf                ← Elastic SAML registration
│   └── apps-stub.tf              ← 10 stub app registrations
│
└── docs/
├── ARCHITECTURE.md           ← Technical decisions + design patterns
├── admin/
│   ├── 01-setup-guide.md     ← Full environment recreation guide
│   ├── 02-security-model.md  ← Security + privilege model
│   └── 03-provisioning.md    ← User lifecycle management
└── user/
├── 01-getting-started.md
└── 02-tailscale-troubleshooting.md
```
---

## Key Design Decisions

### Zero-Hardcode Architecture
No employee names or company data exists in any `.tf` file, and the 
only team name in code is the admin team (`local.admin_team = "ITOps"` 
in `groups.tf`, which `entra_role_map` is validated against). All 
identity data flows from gitignored CSV files, mirroring 
a production HR system SCIM feed. Swap the CSV and the entire 
codebase deploys for any organisation.

### ABAC Dynamic Groups — Self-Healing Identity
Group membership is driven by Entra's ABAC engine, not manual 
Terraform assignments. Change a user's `department` attribute → 
Entra automatically moves them between groups within 5–15 minutes. 
No `terraform apply` needed for routine HR changes. Dynamic 
membership needs Entra ID P1 (see 
[Licensing](#licensing-what-needs-entra-id-p1)).

### setproduct RBAC Matrix
A single Terraform loop manages all group-to-app assignments using 
`setproduct()`. Add a new app → all groups get access automatically. 
Add a new group → it's included in all app assignments instantly.

### Gallery-First App Registration
Microsoft Entra Gallery apps come pre-configured with correct SSO 
protocols and permissions. Custom registrations default to OIDC — 
incompatible with many SaaS SAML implementations. Always search 
the gallery first.

### Validated ETL Pipeline and Roster Guard
The admin passes the two HR exports to the ETL script by name 
(`00-hr-data-etl.sh <employees.csv> <teams.csv>`). The script 
checks headers, field counts, names, duplicates and team values, 
and only replaces `data/` when both files pass. It never deletes 
the source files.

Removing a row from `data/employees.csv` **deletes** that Entra 
account on the next apply. Two guards reduce the risk of a bad 
file: the ETL script reports how many rows were removed, and 
Terraform refuses to plan when the roster has fewer rows than 
`min_expected_employees`. Always read the deletes in 
`terraform plan` before applying.

---

## Licensing: what needs Entra ID P1

The code was built and validated during a Microsoft 365 E5 trial. 
The trial has ended and the tenant is now on **Entra ID Free**. 
Several features this code uses need **Entra ID P1** (included in 
E3/E5 and Business Premium):

| Feature | Used in | License needed | Status on the current Free tenant |
|---|---|---|---|
| Conditional Access (require MFA, block legacy auth) | `conditional-access.tf` | P1 ([source](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview#license-requirements)) | The two policies still exist and are not disabled, but they are frozen: Microsoft allows view and delete only, not update. Any Terraform change to them fails on apply. |
| Dynamic membership groups (team groups) | `groups.tf` | P1 for every member ([source](https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership#license-requirements)) | Not licensed. `jml.tf` records that the rules stopped being processed after the trial, so team membership is not kept current. |
| Group-based app assignment (team groups to the 4 core apps) | `rbac.tf` | P1 or P2 ([source](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/assign-user-or-group-access-portal)) | Not licensed. On Free, apps can be assigned to individual users only. |
| Role-assignable groups (`assignable_to_role`) | `groups.tf`, `rbac.tf` | P1 ([source](https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/groups-concept#license-requirements)) | Not licensed. The groups and their role assignments were created during the trial. |
| Direct role assignment to a user (break-glass Global Admin) | `users.tf` | Free | Works. |
| Users, app registrations, service principals, `app_role_assignment_required` | all | Free | Works. |
| PIM, access reviews (production recommendations only) | not used | P2 / ID Governance | Not used. |

**Suggestion (not implemented, owner's call):** an `entra_premium` 
feature flag that skips or replaces the P1-only resources when the 
tenant has no P1, so `terraform plan` on a Free tenant stays clean.

### Applying the hardened code to a Free tenant

The code is written for a P1/P2 tenant. Applying it to today's Free 
tenant has side effects that a P1 tenant would not have:

| Change | On P1 | On the current Free tenant | What to do |
|---|---|---|---|
| Break-glass loses its `department` | Leaves the dynamic ITOps group, its 4 app assignments and the ITOps Azure role | Membership rules are frozen, so it most likely **stays** in `TinyCo-ITOps` | Check its membership after apply. Removing it needs P1 again, or converting the group to static (a design change, not done here) |
| `app_role_assignment_required = true` on Mattermost, Tableau and Elastic | Only assigned groups get a token | Group assignment is not licensed. Anyone not assigned directly loses SSO: hires added after the trial, every user the JML agent creates (no `department`, and the JML groups have no app assignments), and the primary admin unless their department matches a team | Before apply, assign those users directly to each app (works on Free), or hold these three changes. The 10 stub apps are safe |
| `entra_role_map["Security"]` corrected to Security Reader | The role assignment is replaced | Replace means destroy, then create on a role-assignable group (P1). The create may fail after the old Helpdesk Administrator role is already removed. Fail-safe, but noisy | Change it in its own apply, after everything else |

`prevent_destroy` on the break-glass account also means a full 
`terraform destroy` of the lab now fails on purpose. To tear the lab 
down, remove that `lifecycle` block in a deliberate, reviewed commit 
first.

---

## Documentation Guide

| Goal | Document |
|---|---|
| Understand architecture and design decisions | [ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| Recreate the environment from scratch | [01-setup-guide.md](./docs/admin/01-setup-guide.md) |
| Understand the security and privilege model | [02-security-model.md](./docs/admin/02-security-model.md) |
| Manage users, groups, and applications | [03-provisioning.md](./docs/admin/03-provisioning.md) |
| End user onboarding guide | [01-getting-started.md](./docs/user/01-getting-started.md) |
| Tailscale VPN troubleshooting | [02-tailscale-troubleshooting.md](./docs/user/02-tailscale-troubleshooting.md) |

---

## Security Notes

- No credentials, PII, or sensitive data exists in this repository
- Employee CSV data is gitignored — never committed to version control
- `terraform.tfvars` is gitignored — all secrets stay local
- SSH port 22 is closed to the public internet — VM accessible via Tailscale only
- SAML apps require an app role assignment (`app_role_assignment_required = true`), so unassigned users and guests cannot get a token. Group-based assignment needs Entra ID P1 (see [Licensing](#licensing-what-needs-entra-id-p1))
- Break-glass account: own password, no department (so no dynamic team group on a P1 tenant; on Free see [Applying to a Free tenant](#applying-the-hardened-code-to-a-free-tenant)), permanent active Global Administrator, protected by `prevent_destroy`. See [02-security-model.md](./docs/admin/02-security-model.md#break-glass-account) for the manual steps (FIDO2 passkey or certificate-based auth, sign-in alert)

---

## Official References

| Topic | URL |
|---|---|
| NIST SP 800-207 Zero Trust Architecture | https://csrc.nist.gov/pubs/sp/800/207/final |
| Dynamic membership groups | https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership |
| Role-assignable groups | https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/groups-concept |
| Conditional Access overview | https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview |
| Entra application gallery | https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/overview-application-gallery |
| Automated app provisioning (SCIM) | https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning |
| Terraform azuread provider | https://registry.terraform.io/providers/hashicorp/azuread/latest/docs |
