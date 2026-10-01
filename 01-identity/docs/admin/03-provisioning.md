# TinyCo Entra ID — User & Group Provisioning Guide

**Document Type:** Admin Documentation  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

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
  Entra ID originates from a row in this file, and the team groups 
  are created from its `team` column.
- **`data/teams.csv`**: the team list with each team's apps and 
  role requirements. The ETL script uses it to validate team names; 
  no Terraform code reads it. App access is set in `rbac.tf`.

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

> **Licensing:** dynamic membership and group-based app assignment 
> both need Entra ID P1. The tenant is on Entra ID Free since the E5 
> trial ended, so this self-healing behaviour is not active today. 
> See the licensing matrix in [01-identity/README.md](../../README.md#licensing-what-needs-entra-id-p1).

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

> **SCIM availability:** SCIM auto-provisioning is only configured 
> for Tableau in this environment. Tailscale offers Entra ID SCIM on 
> its Standard, Premium and Enterprise plans 
> ([source](https://tailscale.com/kb/1249/sso-entra-id-scim)), but it 
> needs the tailnet to use Entra ID as its identity provider, which 
> the lab tailnet does not do yet. Mattermost does not support SCIM, 
> and Elastic SCIM requires custom domain verification. See 
> [ARCHITECTURE.md](../ARCHITECTURE.md#official-references--limitation-evidence) 
> for official references.

### Deprovisioning: What Actually Happens

**Removing a row from `data/employees.csv` DELETES the Entra 
account** on the next `terraform apply`. Terraform does not disable 
it. The deleted user goes to Entra's deleted users list, where it 
can be restored for 30 days 
([restore a deleted user](https://learn.microsoft.com/en-us/entra/fundamentals/users-restore)); 
after that it is gone for good.

Once the account is deleted:
- New SSO sign-ins to Mattermost, Tableau and Elastic fail
- Sessions already open inside an app last until that app's own 
  session expires. For an urgent leaver, use the portal steps below 
  (revoke sessions, then disable) before removing the CSV row
- Tableau (SCIM) marks the user inactive within ~40 minutes
- **Tailscale needs manual cleanup.** Without SCIM, Tailscale does 
  not learn about the deletion: suspend or delete the user in the 
  Tailscale admin console 
  ([offboarding without provisioning](https://tailscale.com/docs/use-cases/vpn-replacement/employee-onboarding-offboarding))
- JIT-created accounts in Mattermost and Elastic stay in those apps 
  (unable to sign in via SSO) until removed there

**Safety net:** if `data/employees.csv` has fewer rows than 
`min_expected_employees` (default 80), `terraform plan` stops with 
an error before anything is deleted. The ETL script also reports how 
many rows were removed.

> **Recommendation (not implemented, owner's call):** key users on an 
> immutable `employee_id` instead of `firstname.lastname` (so a 
> name change is not a delete plus create) and model leavers with a 
> `status` column that sets `account_enabled = false` instead of 
> removing the row. That matches the disable-first, keep-for-audit 
> pattern the JML agent uses.

---

## Before Any Terraform Operation

Always authenticate your Azure CLI (Command Line Interface) session 
before running Terraform:
```bash
az login --tenant "<tenant-id>" \
  --scope "https://graph.microsoft.com/.default"
```

Your browser will open for authentication. Complete MFA 
(Multi-Factor Authentication) when prompted.

---

## How to Provision a New User

### Method 1 — Terraform (Preferred)

**Step 1 — Run the ETL pipeline with updated HR data**

Place the updated HR exports in `incoming/` and run, from 
`01-identity/`:
```bash
./scripts/00-hr-data-etl.sh incoming/<employee-export>.csv incoming/<team-export>.csv
```

The script validates both files and prints how many rows were added 
and removed. See [01-setup-guide.md, Step 4](./01-setup-guide.md#step-4--prepare-hr-data) 
for every check it runs.

Or manually add the new employee row to `data/employees.csv`:
first_name,last_name,team
...existing rows...
Alex,Smith,Backend

Valid team names (must match `teams.csv` exactly): `ITOps`, `SRE`, 
`Security`, `Backend`, `Frontend`, `Design`, `Product`, `People Ops`, 
`Legal`

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
1. User account `alex.smith@<tenant>.onmicrosoft.com` created in Entra
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
   - **User principal name:** `firstname.lastname@<tenant>.onmicrosoft.com`
   - **Display name:** `First Last`
   - **First name / Last name:** required for SSO attribute mapping
   - **Department:** must match the team name exactly (e.g. `Backend`)
   - **Job title:** same as department
   - **Password:** a one-off temporary password, or better, issue a 
     [Temporary Access Pass](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-temporary-access-pass) 
     so the user registers their own credentials
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

**What happens:**
1. Entra account **deleted** (restorable from deleted users for 30 days)
2. New SSO sign-ins fail; sessions already open in an app last until 
   that app's session expires
3. Group memberships and app assignments go with the account
4. Tableau SCIM marks user as inactive within ~40 minutes
5. **Manual:** suspend or delete the user in the Tailscale admin 
   console (no SCIM), and remove the JIT accounts in Mattermost and 
   Elastic if you want them gone

If the plan shows more deletions than you expect, stop. Check that 
`data/employees.csv` is complete before applying.

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

> **Note:** New team groups are dynamic and are **not** 
> role-assignable (`assignable_to_role` defaults to `false`). Only 
> the static admin groups created from `entra_role_map` set 
> `assignable_to_role = true`. This property cannot be added to an 
> existing group: it must be set at creation time. To give a new 
> team a directory role, add the team to `entra_role_map`.
>
> Also add the new team to `data/teams.csv`: the ETL script rejects 
> employee rows whose team is not in that file.

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

  # Only assigned users and groups can get a token
  app_role_assignment_required = true

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
and time-bound approval. The break-glass account is the exception: 
Microsoft advises keeping its Global Administrator role permanent 
and active, outside PIM.

### Per-User Initial Credentials

All CSV accounts currently start with the same initial password 
(`admin_password`), which users must change at first sign-in. 
Terraform ignores later changes to it, so rotating the value never 
resets existing users. In production, issue each new user a 
[Temporary Access Pass](https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-temporary-access-pass) 
instead of a shared password.

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

---

## Official References

| Topic | URL |
|---|---|
| Dynamic membership groups | https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership |
| Automated app provisioning (SCIM) | https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning |
| How provisioning works | https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works |
| Entra application gallery | https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/overview-application-gallery |
