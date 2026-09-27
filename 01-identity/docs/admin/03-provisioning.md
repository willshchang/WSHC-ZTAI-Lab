# TinyCo Entra ID — User & Group Provisioning Guide

**Document Type:** Admin Documentation  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** TinyCo IT Administrator  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-Entra-IaC-Zero-Trust-Lab

---

## Overview

This document covers day-to-day administration of the TinyCo Entra ID 
tenant — provisioning new users, deprovisioning departing employees, 
changing team assignments, and adding new groups and applications.

For the full architectural rationale behind the provisioning model, 
see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Provisioning Philosophy

### Source of Truth

TinyCo's identity infrastructure is driven by two CSV 
(Comma-Separated Values) files that act as a stand-in for a 
production HR system:

- **`data/employees.csv`** — the employee roster. Every account in 
  Entra ID originates from a row in this file.
- **`data/teams.csv`** — the team configuration. Group structure and 
  application access is derived from this file.

These files are stored locally and gitignored — they contain personal 
information that must never be committed to version control.

**The operational principle:**
> Make the change in the CSV first. Then run `terraform apply`. 
> Entra ID reflects the CSV — always.

This mirrors how a production HRIS (Human Resources Information 
System) integration works. In a future production environment, 
these CSV files would be replaced by a direct SCIM (System for 
Cross-domain Identity Management) feed from an HR system like ADP — 
the Terraform code itself would require minimal modification to 
support that upgrade.

### Self-Healing Identity

Once a user is provisioned via Terraform, the system maintains 
itself automatically:

- Entra ID's ABAC (Attribute-Based Access Control) engine evaluates 
  dynamic group membership rules continuously
- When a user's `department` attribute changes, group membership 
  updates within **5–15 minutes** — no `terraform apply` needed
- App access follows group membership — access granted and revoked 
  automatically

For a full explanation of the self-healing design, see 
[ARCHITECTURE.md — Self-Healing Identity Design](../ARCHITECTURE.md#self-healing-identity-design).

### Provisioning Methods

For each operation, two methods are documented:

- **Terraform method** — preferred for all changes. Changes are 
  version controlled, auditable, and reproducible.
- **Entra portal method** — for urgent situations where speed is 
  required. Must be followed up with a CSV and Terraform update 
  to keep the codebase in sync.

### Provisioning Model Per Application

| Application | Provisioning Method | Notes |
|---|---|---|
| **Tailscale** | JIT via OIDC SSO | Account created on first login |
| **Mattermost** | JIT via SAML SSO | Account created on first login |
| **Tableau** | SCIM + JIT via SAML | Account pre-created by SCIM (~40 min after group assignment) |
| **Elastic** | JIT via SAML SSO | Account created on first login |

> **SCIM availability:** SCIM auto-provisioning is only available 
> for Tableau in this environment. Tailscale SCIM requires Enterprise 
> plan, Mattermost does not support SCIM, and Elastic SCIM requires 
> custom domain verification. See 
> [ARCHITECTURE.md](../ARCHITECTURE.md#official-references--limitation-evidence) 
> for official references.

### Deprovisioning for JIT Applications

For applications using JIT (Just-in-Time) provisioning via SSO, 
deprovisioning in Entra is sufficient:

- Remove user from CSV → `terraform apply` → Entra account disabled
- Disabled Entra account cannot authenticate via SSO
- User is effectively locked out of all JIT apps immediately
- No manual account deletion required in Tailscale, Mattermost, 
  or Elastic

For Tableau (SCIM), the account is automatically deactivated 
within ~40 minutes of Entra group removal.

**Deprovisioning is immediate for SSO-gated apps** — the moment 
an Entra account is disabled, all active sessions are revoked and 
no new SSO logins are possible. This is one of the core security 
benefits of centralised identity via Entra ID.

---

## Before Any Terraform Operation

Always authenticate your Azure CLI (Command Line Interface) session 
before running Terraform:
```bash
az login --tenant "42a9915e-aa4a-4426-9a86-a04a0dac6222" \
  --scope "https://graph.microsoft.com/.default"
```

Your browser will open for authentication. Complete MFA 
(Multi-Factor Authentication) when prompted.

---

## How to Provision a New User

### Method 1 — Terraform (Preferred)

**Step 1 — Run the ETL pipeline with updated HR data**

Place the updated employee CSV in `incoming/` and run:
```bash
chmod +x scripts/00-hr-data-etl.sh
./scripts/00-hr-data-etl.sh
```

Or manually add the new employee row to `data/employees.csv`:
first_name,last_name,team
...existing rows...
Alex,Smith,Backend

Valid team names: `ITOps`, `SRE`, `Security`, `Backend`, `Frontend`, 
`Design`, `Product`, `PeopleOps`, `Legal`

**Step 2 — Preview the change**
```bash
cd terraform
terraform plan
```

Confirm the plan shows exactly 1 new user being added. Review 
before proceeding.

**Step 3 — Apply the change**
```bash
terraform apply
```

Type `yes` when prompted.

**What happens automatically:**
1. User account `alex.smith@TinyCoDDG.onmicrosoft.com` created in Entra
2. `department = "Backend"` attribute written to the account
3. ABAC engine picks up the attribute change within 5–15 minutes
4. User added to `TinyCo-Backend` dynamic group automatically
5. App role assignments grant access to all four core applications
6. Tableau SCIM provisions the user in Tableau Cloud within ~40 minutes
7. On first SSO login to any app, JIT creates the local account

---

### Method 2 — Entra Portal (Urgent)

Use this method only when immediate provisioning is required and 
`terraform apply` cannot be run.

1. **Entra admin centre** → **Users** → **New user** → 
   **Create new user**
2. Fill in:
   - **User principal name:** `firstname.lastname@TinyCoDDG.onmicrosoft.com`
   - **Display name:** `First Last`
   - **First name / Last name:** required for SSO attribute mapping
   - **Department:** must match the team name exactly (e.g. `Backend`)
   - **Job title:** same as department
   - **Password:** standard TinyCo temporary password
   - **Force password change:** Yes
3. Click **Create**

> **Important:** The `department` field must match the team name 
> exactly — this is what triggers dynamic group membership via the 
> ABAC engine. A typo means the user won't be added to their group.

> **Follow up:** Add the user to `data/employees.csv` and run 
> `terraform apply` to keep the codebase in sync.

---

## How to Deprovision a User

### Method 1 — Terraform (Preferred)

**Step 1 — Remove the employee from `data/employees.csv`**

Delete the employee's row from the CSV file.

**Step 2 — Preview the change**
```bash
terraform plan
```

Carefully review — confirm only the intended user is being removed.

**Step 3 — Apply**
```bash
terraform apply
```

**What happens automatically:**
1. Entra account disabled
2. All active sessions revoked immediately
3. SSO login blocked across all applications instantly
4. Removed from all dynamic groups within 5–15 minutes
5. Tableau SCIM marks user as inactive within ~40 minutes
6. No manual cleanup required in JIT apps (Tailscale, Mattermost, Elastic)

---

### Method 2 — Entra Portal (Immediate Access Revocation)

For urgent terminations where immediate access cut-off is required:

1. **Entra admin centre** → **Users** → search for the user
2. Click **Revoke sessions** — immediately invalidates all active 
   sessions across all applications
3. Click **Edit** → set **Account enabled** to **No** → **Save**

> **Follow up:** Remove the user from `data/employees.csv` and run 
> `terraform apply` to keep the codebase in sync.

---

## How to Change a User's Team

When an employee moves between teams, their group membership, 
RBAC (Role-Based Access Control) permissions, and application 
access all update automatically via the ABAC engine.

### Method 1 — Terraform (Preferred)

**Step 1 — Update the team value in `data/employees.csv`**
Before
Alex,Smith,Backend
After
Alex,Smith,Frontend

**Step 2 — Preview and apply**
```bash
terraform plan
terraform apply
```

**What happens automatically:**
1. Terraform writes `department = "Frontend"` to Alex's Entra account
2. ABAC engine removes Alex from `TinyCo-Backend` within 5–15 minutes
3. ABAC engine adds Alex to `TinyCo-Frontend` within 5–15 minutes
4. App access updates to match new group membership

> **Note:** There is a 5–15 minute window between `terraform apply` 
> completing and the group membership updating. This is expected 
> behaviour — Microsoft's ABAC engine processes rules asynchronously.

---

### Method 2 — Entra Portal

1. **Users** → find the user → **Edit** → update **Department** 
   field to new team name → **Save**
2. The ABAC engine will automatically update group membership 
   within 5–15 minutes

---

## How to Add a New Team

No Terraform code changes are required to add a new team. The 
codebase discovers teams dynamically from the CSV.

**Add employees with the new team name to `data/employees.csv`:**
Sarah,Jones,Finance
Michael,Brown,Finance

**Run:**
```bash
terraform plan
terraform apply
```

**What happens automatically:**
1. Terraform's `distinct()` function detects `Finance` as a new 
   unique team value
2. A new `TinyCo-Finance` dynamic group is created
3. All Finance employees are added to the group via ABAC
4. The `setproduct` matrix automatically assigns Finance to all 
   core applications

> **Note:** New groups are created with `assignable_to_role = true` 
> by default. This property cannot be added to an existing group — 
> it must be set at creation time.

---

## How to Add a New Application

**Step 1 — Search the Microsoft Gallery first**

Before writing any Terraform code, check if the app exists in the 
Microsoft Entra Gallery:
```bash
./scripts/01-gallery-lookup.sh "AppName"
```

- **Found in gallery** → register via Entra portal (recommended) 
  or use `azuread_application_template` in Terraform
- **Not found** → create custom registration via Terraform with 
  explicit SAML configuration

**Step 2 — Create a new Terraform file**

For custom apps, create `terraform/[appname].tf`:
```hcl
resource "azuread_application" "notion" {
  display_name    = "${var.company_name}-Notion-SAML"
  identifier_uris = ["https://www.notion.so/saml/metadata"]

  app_role {
    allowed_member_types = ["User"]
    description          = "Standard Access to Notion"
    display_name         = "Standard User"
    enabled              = true
    id                   = "YOUR-UNIQUE-UUID-HERE"
    value                = "User"
  }

  web {
    redirect_uris = ["https://www.notion.so/sso/saml"]
  }
}

resource "azuread_service_principal" "notion" {
  client_id                     = azuread_application.notion.client_id
  preferred_single_sign_on_mode = "saml"

  feature_tags {
    enterprise            = true
    custom_single_sign_on = true
  }
}
```

> **Critical:** Always set `preferred_single_sign_on_mode = "saml"` 
> for custom apps. Without this, Entra defaults to OIDC which is 
> incompatible with many SaaS SSO implementations.

**Step 3 — Add to the RBAC matrix**

In `rbac.tf`, add the new app to both maps:
```hcl
apps_to_assign = {
  ...existing apps...
  "Notion" = azuread_service_principal.notion.object_id
}

app_role_ids = {
  ...existing apps...
  "Notion" = "YOUR-UNIQUE-UUID-HERE"
}
```

**Step 4 — Apply and configure SSO**
```bash
terraform plan
terraform apply
```

Then complete the SSO handshake in the Entra portal:
1. **Enterprise Applications** → find the new app
2. **Single sign-on** → **SAML**
3. Fill in Entity ID and ACS URL from vendor documentation
4. Download Federation Metadata XML
5. Upload to the app's admin portal

**Step 5 — Configure SCIM (if supported)**

1. Enterprise App → **Provisioning** → **Automatic**
2. Enter SCIM endpoint URL and bearer token from vendor
3. **Test Connection** → **Save** → **Start provisioning**

---

## Production Recommendations

### HR System Direct Integration

Replace the CSV dropzone with a direct SCIM feed from ADP 
(already registered as a stub application). New hire data flows 
automatically from HR into Entra — the `data/employees.csv` 
file becomes unnecessary.

### Privileged Identity Management (PIM)

Implement PIM (Privileged Identity Management) for all privileged 
roles. Global Administrators would hold eligible (not permanent) 
access — activating only when needed with a logged justification 
and time-bound approval.

### Automated Access Reviews

Schedule quarterly access reviews using Entra ID Governance. 
Group owners confirm each member still requires access — 
preventing permission creep over time.

### Terraform Remote State

Move `terraform.tfstate` to Azure Blob Storage with state locking. 
This enables multiple administrators to run Terraform safely 
without state file conflicts.

### Per-App RBAC with Least Privilege

Replace the current `setproduct` all-teams matrix with dedicated 
per-app RBAC files implementing least-privilege role assignments. 
See [ARCHITECTURE.md](../ARCHITECTURE.md#per-app-rbac-design) 
for the full production design.