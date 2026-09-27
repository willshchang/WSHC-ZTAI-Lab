# TinyCo Entra ID — Architecture & Technical Design

**Document Type:** Technical Architecture  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** Reviewer  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-Entra-IaC-Zero-Trust-Lab

---

## Overview

This document is the technical bible for TinyCo's Microsoft Entra ID 
(formerly Azure Active Directory) identity infrastructure. It covers 
every major architectural decision made during the project, the 
reasoning behind each decision, and what a production-grade version 
of this environment would look like with more time and budget.

For how it went and what I would do differently, see 
[RETROSPECTIVE.md](./RETROSPECTIVE.md).

For operational procedures (provisioning, deprovisioning, app 
management), see [Admin Documentation](./admin/).

---

## Table of Contents

1. [Glossary](#glossary)
2. [System Overview](#system-overview)
3. [Core Design Decisions](#core-design-decisions)
4. [Self-Healing Identity Design](#self-healing-identity-design)
5. [App Registration — Gallery vs Custom](#app-registration--gallery-vs-custom)
6. [Per-App RBAC Design](#per-app-rbac-design)
7. [Production Design — More Time & Budget](#production-design--more-time--budget)
8. [Official References & Limitation Evidence](#official-references--limitation-evidence)

---

## Glossary

| Term | Full Name | Definition |
|---|---|---|
| **ABAC** | Attribute-Based Access Control | Access decisions driven by user attributes rather than manual assignments |
| **RBAC** | Role-Based Access Control | Access decisions driven by assigned roles |
| **CA** | Conditional Access | Entra's policy engine — if/then security rules |
| **SCIM** | System for Cross-domain Identity Management | Protocol for automated user provisioning between systems |
| **SAML** | Security Assertion Markup Language | Federation protocol for SSO between identity providers and apps |
| **OIDC** | OpenID Connect | Modern authentication protocol built on OAuth 2.0 |
| **JIT** | Just-in-Time provisioning | User account created automatically on first SSO login |
| **IaC** | Infrastructure as Code | Managing infrastructure via code rather than manual configuration |
| **IdP** | Identity Provider | The system that authenticates users — Entra ID in TinyCo's case |
| **SP** | Service Provider | The application receiving the authentication — Tableau, Mattermost etc |
| **MFA** | Multi-Factor Authentication | Requiring a second verification factor beyond password |
| **UPN** | User Principal Name | A user's email-format login identifier in Entra |
| **PIM** | Privileged Identity Management | Just-in-time elevation of admin privileges with approval and logging |
| **ETL** | Extract, Transform, Load | The pipeline that moves and cleans data from one system to another |
| **BOM** | Byte Order Mark | Invisible UTF-8 signature Windows adds to CSV files, breaks Terraform csvdecode |
| **ACL** | Access Control List | Tailscale's internal network routing rules |
| **MyApps** | Microsoft MyApps Portal | The end-user portal at myapps.microsoft.com showing all assigned apps |

---

## System Overview

TinyCo's identity infrastructure follows a **Zero Trust** model with 
two distinct security layers:

- **Tailscale** gates access to internal infrastructure (Azure VM, 
  Mattermost). Nothing on the private network is reachable without 
  an active Tailscale connection authenticated via Entra ID.

- **Entra ID SSO** gates access to cloud SaaS applications (Tableau, 
  Elastic). Authentication is enforced via SAML (Security Assertion 
  Markup Language) or OIDC (OpenID Connect) — no local credentials 
  are accepted.

### Identity Journey
```
A new TinyCo employee's identity flows through the following stages 
automatically:
HR CSV file (incoming/ dropzone)
↓
ETL pipeline (scripts/00-hr-data-etl.sh)
↓ cleans BOM, standardises headers
Clean CSV (data/)
↓
Terraform apply
↓ reads CSV, provisions Entra account with all attributes
Entra user account created
↓ MFA enforced via Conditional Access
ABAC dynamic group assignment (5–15 min)
↓ department attribute triggers group membership
App role assignment (setproduct matrix)
↓ group membership grants app access
SSO login (SAML/OIDC)
↓ first login creates account in app via JIT
SCIM sync (Tableau only, ~40 min)
↓ account pre-created before first login
Full access granted
```
![TinyCo Identity Journey](./tinyco_identity_journey.png)

---

## Core Design Decisions

### 1. Zero-Hardcode Paradigm (Data Decoupling)

**Challenge:** Hardcoding team names, employee names, or company 
details directly into Terraform logic files creates brittle code that 
requires manual rewrites if the organisation rebrands or if the module 
is ported to a new client.

**Decision:** All organisational data is abstracted into two sources:

- `terraform.tfvars` — company identity, tenant IDs, role mappings. 
  Gitignored. Never on GitHub.
- `data/employees.csv` — employee roster. Gitignored. Never on GitHub.
- `data/teams.csv` — team configuration. Gitignored. Never on GitHub.

**Result:** Every `.tf` logic file contains zero company-specific 
strings. The entire codebase is a reusable module — swap the CSV 
files and tfvars, and it deploys for any organisation.

---

### 2. ABAC (Attribute-Based Access Control) via Dynamic Groups

**Challenge:** Statically assigning users to groups via Terraform 
`azuread_group_member` blocks creates a dependency on manual code 
execution for every HR change. Onboarding, offboarding, and team 
transfers all require a `terraform apply`.

**Decision:** Shift group membership to Entra ID's internal ABAC 
engine using Dynamic Membership rules.

**How it works:**
- Terraform writes the CSV `team` value to the user's `department` 
  attribute in Entra
- Each group has a dynamic rule: 
  `(user.department -eq "TeamName")`
- Entra evaluates this rule continuously — users are added or removed 
  automatically within 5–15 minutes of an attribute change

**Self-healing behaviour:**
> Paula transfers from Backend to Frontend. HR updates the CSV. 
> `terraform apply` writes `department = "Frontend"` to Paula's 
> Entra account. Entra's ABAC engine removes her from 
> `TinyCo-Backend` and adds her to `TinyCo-Frontend` automatically. 
> Her Tableau and Elastic access updates within 15 minutes. 
> No IT intervention required.

**Important constraint:** Microsoft requires groups that hold Entra 
Directory Roles (e.g., Global Administrator) to be **Static**, not 
Dynamic. ABAC Dynamic Groups cannot be assigned directory roles.

**Solution — Twin Group Architecture:**
- **Dynamic group** — handles automatic app access via ABAC
- **Static admin group** (`assignable_to_role = true`) — holds the 
  actual Entra directory role
- **Bridge** — `groups.tf` filters the CSV for privileged teams 
  (ITOps, Security) and explicitly copies them into the Static admin 
  groups via `azuread_group_member`

This maintains the zero-manual-intervention workflow while satisfying 
Microsoft's API constraint.

---

### 3. setproduct RBAC Matrix

**Challenge:** Assigning multiple groups to multiple SaaS applications 
typically requires dozens of repetitive resource blocks — one per 
group per app.

**Decision:** Use Terraform's `setproduct()` function to generate a 
multidimensional matrix of every group/app combination.
```hcl
group_app_pairs = {
  for pair in setproduct(keys(azuread_group.teams), 
                         keys(local.apps_to_assign)) :
  "${pair[0]}-${pair[1]}" => {
    group_id = azuread_group.teams[pair[0]].object_id
    app_id   = local.apps_to_assign[pair[1]]
    role_id  = local.app_role_ids[pair[1]]
  }
}
```

**Result:** A single `azuread_app_role_assignment` resource block 
manages all group-to-app assignments. 9 groups × 4 apps = 36 
assignments created by one loop.

**Important distinction — Lab vs Production:**

> The current matrix assigns **all 9 groups to all 4 apps**. This is 
> intentional for the lab environment — TinyCo's project brief 
> specifies that all team members have access to the specified 
> applications.
>
> In production, the `setproduct` matrix would only be used for 
> **genuinely company-wide apps** (Mattermost, Tailscale). 
> Apps requiring role differentiation (Tableau, Elastic) would 
> have dedicated per-app RBAC files implementing least-privilege 
> role assignments. See [Per-App RBAC Design](#per-app-rbac-design).

---

### 4. Group-Based Conditional Access (CA) Exclusions

**Challenge:** CA policies that hardcode specific user IDs for 
emergency exclusions are brittle. If the break-glass account is 
rotated, the policy must be updated. The exclusion is invisible in 
audit logs — just a GUID.

**Decision:** Target a dedicated static security group instead of 
individual user IDs.
```hcl
excluded_groups = [azuread_group.security_exclusion.object_id]
```

**Result:** The `Security-Exclusion-Emergency` group acts as the 
VIP list. Granting or revoking emergency bypass access is a standard 
group membership operation — visible, auditable, and reversible 
without touching any security policy code.

---

### 5. Dropzone ETL Pipeline

**Challenge:** HR CSV exports from Windows contain a UTF-8 BOM 
(Byte Order Mark) — three invisible bytes that cause Terraform's 
`csvdecode()` to fail. Wildcard file searches for HR data are 
dangerous — a script that searches `*employee*` could accidentally 
pick up a terminated employee list and trigger mass deprovisioning.

**Decision:** Implement a staged dropzone architecture.
incoming/     ← IT admin drops raw HR export here
↓
scripts/00-hr-data-etl.sh
↓ strips BOM, standardises headers, validates files
data/         ← clean files ready for Terraform

**Security rationale:** The ETL script only processes files explicitly 
placed in `incoming/` by the IT admin. No wildcard searches. No 
accidental file ingestion. One wrong file cannot trigger mass 
deprovisioning.

---

## Self-Healing Identity Design

TinyCo's infrastructure is designed to maintain itself. Rather than 
requiring IT intervention for routine identity operations, the system 
responds automatically to data changes at the source.

### The Self-Healing Chain
HR updates employee data
↓
CSV updated in incoming/ → ETL pipeline → data/
↓
terraform apply writes attributes to Entra
↓
ABAC engine re-evaluates dynamic group membership (5–15 min)
↓
setproduct matrix app assignments update automatically
↓
SCIM syncs to Tableau (~40 min)
↓
User's access reflects their current role — zero IT intervention

### Self-Healing Patterns

| Pattern | Mechanism | Trigger |
|---|---|---|
| **Dynamic group membership** | ABAC rule evaluates `department` attribute | `terraform apply` writes new department value |
| **New team auto-discovery** | `distinct()` scans CSV for unique teams | New team name added to CSV |
| **App access matrix expansion** | `setproduct()` includes new groups automatically | New group created from CSV |
| **Break-glass name derivation** | `title(split(".", prefix))` generates display name | `grader_account_prefix` changed in tfvars |
| **CA exclusion inheritance** | Group membership triggers policy exclusion | User added to Security-Exclusion-Emergency |
| **Attribute enrichment cascade** | One CSV `team` value writes `department` + `job_title` | Single CSV column change |

---

## App Registration — Gallery vs Custom

### The Golden Rule

> **Always search the Microsoft Entra Gallery before creating a 
> custom app registration.**

Gallery apps come pre-configured with:
- Correct SSO protocol (SAML or OIDC) for that specific vendor
- Pre-set attribute mappings
- SCIM provisioning support where the vendor offers it
- Admin consent pre-granted by Microsoft
- Vendor-maintained integration updates

Custom app registrations require manual configuration of all of the 
above and default to OIDC — which is not always compatible with the 
app's SSO requirements.

### Our Mistake — Lesson Learned

During the initial lab phase, all four apps (Tailscale, Mattermost, 
Tableau, Elastic) were registered as custom OIDC apps via Terraform's 
`azuread_application` resource. This caused:

- Tableau SSO failures (SAML required, OIDC registered)
- Mattermost OAuth errors (SSL detection issues with OIDC flow)
- Elastic permission errors (custom app missing pre-consented permissions)
- Days of debugging that would have been avoided with gallery registration

### App Registration Decision Matrix

| App | Type | Protocol | Gallery Available | SCIM |
|---|---|---|---|---|
| **Tailscale** | Multi-tenant SaaS | OIDC | ✅ Auto-registers on admin login | ❌ Enterprise plan required |
| **Mattermost** | Self-hosted | SAML | ❌ Custom registration required | ❌ Vendor not supported |
| **Tableau** | SaaS | SAML | ✅ Gallery app available | ✅ Requires SAML first |
| **Elastic** | Multi-tenant SaaS | OIDC/SAML | ✅ Gallery app available | ❌ Custom domain required |

### How to Check the Gallery (Manual — Recommended)

1. **Entra admin centre** → **Enterprise Applications** → 
   **New application**
2. Search the app name in the gallery search box
3. If found — click to register. Done. Gallery handles the rest.
4. If not found — proceed with custom registration via Terraform

### How to Check the Gallery (Scripted)
```bash
# scripts/01-gallery-lookup.sh
# Usage: ./scripts/01-gallery-lookup.sh "Mattermost"

APP_NAME="$1"
echo "Searching Microsoft Gallery for: $APP_NAME"

az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/applicationTemplates" \
  --query "value[?contains(displayName, '$APP_NAME')].{Name:displayName, ID:id}" \
  --output table
```

### Gallery App Registration in Terraform

When a gallery app is confirmed to exist, use the 
`azuread_application_template` data source:
```hcl
data "azuread_application_template" "tableau" {
  display_name = "Tableau Cloud"
}

resource "azuread_service_principal" "tableau" {
  application_template_id = data.azuread_application_template.tableau.template_id
  use_existing            = true
}
```

### Custom App Registration in Terraform

When no gallery app exists (Mattermost), explicitly set SAML as the 
preferred SSO mode:
```hcl
resource "azuread_application" "mattermost" {
  display_name    = "${var.company_name}-Mattermost-SAML"
  identifier_uris = ["https://${var.app_urls["mattermost"]}"]

  app_role {
    allowed_member_types = ["User"]
    description          = "Standard Access to Mattermost"
    display_name         = "Standard User"
    enabled              = true
    id                   = "22222222-2222-2222-2222-222222222222"
    value                = "User"
  }

  web {
    redirect_uris = ["https://${var.app_urls["mattermost"]}/login/sso/saml"]
  }
}

resource "azuread_service_principal" "mattermost" {
  client_id                     = azuread_application.mattermost.client_id
  preferred_single_sign_on_mode = "saml"

  feature_tags {
    enterprise            = true
    custom_single_sign_on = true
  }
}
```

**Key:** `preferred_single_sign_on_mode = "saml"` explicitly locks 
the app to SAML. Without this, Entra defaults to OIDC.

---

## Per-App RBAC Design

### Current Lab Approach
```
The lab uses a single `setproduct` matrix assigning all groups to all 
apps. This satisfies the project brief's requirement that all team 
members have access to specified applications.

### Production Approach — Per-App RBAC Files

In production, each app requiring role differentiation gets its own 
dedicated RBAC file. This mirrors enterprise IT policy management 
where one policy handles one payload — clean audit logs, clear 
ownership, safe rollbacks.
terraform-prod/
├── rbac-global.tf       ← company-wide apps (Mattermost, Tailscale)
├── rbac-tableau.tf      ← Tableau role assignments
├── rbac-elastic.tf      ← Elastic role assignments
└── rbac-mattermost.tf   ← Mattermost admin assignments
```
### Least Privilege Role Matrix (Production)

| Team | Tailscale | Mattermost | Tableau | Elastic |
|---|---|---|---|---|
| **ITOps** | User | Admin | Creator | Admin |
| **SRE** | User | User | Explorer | Editor |
| **Security** | User | User | Viewer | Editor |
| **Backend** | User | User | Viewer | Viewer |
| **Frontend** | User | User | Viewer | Viewer |
| **Design** | User | User | Explorer | Viewer |
| **Product** | User | User | Creator | Viewer |
| **PeopleOps** | User | User | Viewer | — |
| **Legal** | User | User | Viewer | — |

### Tableau Role Design (Production)

The lab assigns all users as `SiteAdministratorCreator` — this hit 
Tableau Cloud's free trial license limit immediately with 89 users, 
resulting in 68 accounts being set to Unlicensed automatically.

This confirmed in practice why least-privilege role assignment matters 
— not just for security, but for license cost management.

**Production approach — dedicated Tableau role groups:**
```hcl
# Entra groups mapped to Tableau roles
TinyCo-Tableau-Creator   → ITOps, Product, SRE
TinyCo-Tableau-Explorer  → Design, Frontend
TinyCo-Tableau-Viewer    → Security, Backend, Legal, PeopleOps
```

**SCIM role mapping per group:**
- `TinyCo-Tableau-Creator` → `SiteAdministratorCreator`
- `TinyCo-Tableau-Explorer` → `ExploreWithPublish`  
- `TinyCo-Tableau-Viewer` → `Viewer`

This approach:
- Stays within license limits
- Applies least privilege per team function
- Makes license costs predictable and auditable

### Example — Production Tableau RBAC File
```hcl
# rbac-tableau.tf
# One file, one app, clear audit trail

locals {
  tableau_role_assignments = {
    "ITOps"    = { group = "ITOps",    role = "SiteAdministratorCreator" }
    "Product"  = { group = "Product",  role = "SiteAdministratorCreator" }
    "SRE"      = { group = "SRE",      role = "ExploreWithPublish" }
    "Design"   = { group = "Design",   role = "ExploreWithPublish" }
    "Security" = { group = "Security", role = "Viewer" }
    "Backend"  = { group = "Backend",  role = "Viewer" }
    "Legal"    = { group = "Legal",    role = "Viewer" }
  }
}

resource "azuread_app_role_assignment" "tableau_roles" {
  for_each = local.tableau_role_assignments

  app_role_id         = local.tableau_role_ids[each.value.role]
  principal_object_id = azuread_group.teams[each.value.group].object_id
  resource_object_id  = azuread_service_principal.tableau.object_id
}
```

---

## Production Design — More Time & Budget

This section documents what TinyCo's identity infrastructure would 
look like with additional time, budget, and planning. These are not 
theoretical improvements — they are the natural next steps in a 
production deployment.

### 1. Custom Domain (~$15 CAD/year)

**Impact:** Unlocks multiple blocked capabilities:

- **Elastic org-level SSO** — currently only deployment-level 
  (Kibana) SSO is available because Elastic Cloud's organisation-level 
  SSO requires DNS verification of a custom domain. 
  `onmicrosoft.com` DNS cannot be modified.
  
  *Reference: Elastic Cloud SAML SSO requires verified domain:*
  *https://www.elastic.co/docs/deploy-manage/users-roles/cloud-organization/configure-saml-authentication*

- **Let's Encrypt SSL for Mattermost** — a real domain enables free 
  automatic SSL certificates via certbot, eliminating the need for 
  Tailscale Serve as an HTTPS workaround.

- **Professional email domain** — `@tinyco.com` instead of 
  `@TinyCoDDG.onmicrosoft.com` for all user accounts.

### 2. Tailscale Enterprise Plan

**Impact:** Enables SCIM (System for Cross-domain Identity Management) 
provisioning for Tailscale. Users added to Entra groups would be 
automatically provisioned in Tailscale without manual approval.

Currently on Premium plan — SCIM is an Enterprise-only feature.

*Reference: Tailscale SCIM requires Enterprise plan:*
*https://tailscale.com/kb/1249/sso-entra-id-scim*

> *"This feature is available for the Enterprise plan."*

### 3. Mattermost SCIM

**Impact:** Not achievable regardless of plan or budget — Mattermost 
does not support SCIM provisioning. JIT (Just-in-Time) provisioning 
via SAML SSO is the only supported automated provisioning method.

*Reference: Mattermost provisioning documentation:*
*https://docs.mattermost.com/administration-guide/onboard/sso-entraid.html*

**Production workaround:** Use Mattermost's LDAP sync feature with 
Entra ID via Azure AD Connect for attribute synchronisation. This 
requires Microsoft Entra ID P1 or higher — already included in the 
E5 trial used in this project.

### 4. Privileged Identity Management (PIM)

**Impact:** ITOps members would hold **eligible** Global Administrator 
access rather than permanent Global Administrator. Activation requires:
- A written justification
- Time-bound approval (e.g. 4 hours maximum)
- Full audit log of every activation

Reduces the blast radius of a compromised ITOps account from 
"permanent tenant-wide admin" to "temporary approved access with 
logged justification."

Requires: Microsoft Entra ID P2 — included in E5 trial.

### 5. Terraform Remote State

**Impact:** Moves `terraform.tfstate` from a local file to Azure Blob 
Storage with state locking. Multiple IT administrators can safely run 
Terraform simultaneously without state file conflicts or corruption.
```hcl
terraform {
  backend "azurerm" {
    resource_group_name  = "TinyCo-Terraform-State"
    storage_account_name = "tinycoterraformstate"
    container_name       = "tfstate"
    key                  = "prod.terraform.tfstate"
  }
}
```

### 6. ADP HRIS Direct SCIM Integration

**Impact:** Eliminates the CSV dropzone entirely. New hire data flows 
directly from ADP (already registered as a stub app) into Entra via 
SCIM. The `employees.csv` file becomes unnecessary.

The current Terraform code structure supports this upgrade with 
minimal changes — the CSV data source is replaced with an HRIS SCIM 
endpoint. The identity logic files remain unchanged.

### 7. Automated Access Reviews

**Impact:** Entra ID Governance schedules quarterly access reviews. 
Group owners are prompted to confirm each member still requires access. 
Stale permissions are removed automatically if not re-approved.

Requires: Microsoft Entra ID Governance — available as an add-on to 
E5.

### 8. Full IaC App Registration Pipeline

**Impact:** Instead of manually searching the Entra gallery, a 
scripted workflow handles the decision:
scripts/01-gallery-lookup.sh [AppName]
↓ queries Microsoft Graph API for gallery templates
Found in gallery?
↓ Yes → use azuread_application_template in Terraform
↓ No  → use custom azuread_application with SAML explicit
terraform apply

This completes the IaC story — from HR data ingestion to app 
registration, the entire identity stack is code-driven.

### 9. Per-App RBAC with Least Privilege

As documented in [Per-App RBAC Design](#per-app-rbac-design) — 
dedicated RBAC files per app implementing the full least privilege 
role matrix.

---

## Official References & Limitation Evidence

| Limitation | Official Reference |
|---|---|
| Tailscale SCIM — Enterprise plan required | https://tailscale.com/kb/1249/sso-entra-id-scim |
| Mattermost SCIM — not supported | https://docs.mattermost.com/administration-guide/onboard/sso-entraid.html |
| Elastic org-level SSO — custom domain required | https://www.elastic.co/docs/deploy-manage/users-roles/cloud-organization/configure-saml-authentication |
| Tableau SCIM — SAML prerequisite | https://help.tableau.com/current/online/en-us/scim_config_azure_ad.htm |
| Microsoft Dynamic Groups — cannot hold directory roles | https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership |
| Entra SCIM provisioning — P1/P2 required | https://learn.microsoft.com/en-us/entra/identity/saas-apps/tableau-online-provisioning-tutorial |
