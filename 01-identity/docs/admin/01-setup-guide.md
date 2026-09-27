# TinyCo Entra ID — Setup & Recreation Guide

**Document Type:** Admin Documentation  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** TinyCo IT Administrator  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-Entra-IaC-Zero-Trust-Lab

---

## Overview

This guide provides complete step-by-step instructions to recreate 
the TinyCo Microsoft Entra ID (formerly Azure Active Directory) 
environment from scratch using the provided Terraform (IaC — 
Infrastructure as Code) code.

A reviewer or administrator following this guide should be able to 
fully reproduce the environment with no prior knowledge of how it 
was originally built.

**What this guide deploys:**
- 89 TinyCo employee accounts across 9 teams
- 9 Entra security groups with dynamic membership
- Full RBAC (Role-Based Access Control) model
- Conditional Access (CA) policies enforcing MFA tenant-wide
- 14 Enterprise Application registrations (4 fully configured, 
  10 stubbed)
- A dedicated break-glass testing account

For the full architectural rationale behind these decisions, 
see [ARCHITECTURE.md](../ARCHITECTURE.md).

---

## Minimum System Requirements

| Tool | Minimum Version | Download |
|---|---|---|
| Terraform | 1.5+ | https://developer.hashicorp.com/terraform/install |
| Azure CLI | 2.50+ | https://aka.ms/installazurecliwindowsx64 |
| Git | 2.39+ | https://git-scm.com/download/win |
| VS Code | Any recent | https://code.visualstudio.com |

**Operating system:** Windows 10/11, macOS 12+, or Ubuntu 20.04+

---

## Required Accounts

| Account | Purpose | Cost |
|---|---|---|
| Microsoft 365 E5 Trial | Entra ID P2, Conditional Access, ID Governance | Free (30 days) |
| Azure Free Account | $200 CAD credit, VM hosting, RBAC scope | Free credit |
| Tailscale Premium | VPN with SSO | ~$18 USD/month |
| GitHub | Code repository | Free |

> **Tailscale note:** The free trial lasts 14 days. Since the 
> review window extends beyond 14 days, Tailscale Premium was chosen 
> to ensure the environment remains accessible throughout the full 
> review period. The $18 USD/month cost for 1 active user falls 
> within the allocated budget.

---

## Step 1 — Microsoft 365 & Azure Setup

### 1.1 Create Microsoft 365 E5 Trial

1. Go to **microsoft.com/en-us/microsoft-365/enterprise/office-365-e5**
2. Click **Try for free** → sign up with a new email
3. Choose your tenant domain — this guide uses 
   `TinyCoDDG.onmicrosoft.com`
4. Complete setup — your admin account will be 
   `WC@TinyCoDDG.onmicrosoft.com`

### 1.2 Link Azure Free Account

1. Go to **portal.azure.com** and sign in with your M365 admin account
2. Sign up for a free Azure account — $200 CAD credit included
3. Verify the subscription appears under your TinyCo tenant
4. Note your **Subscription ID** — needed for Terraform variables

### 1.3 Create Tailscale Account

1. Go to **tailscale.com** → click **Get Started**
2. Sign in using **Microsoft** (`WC@TinyCoDDG.onmicrosoft.com`)

> **Why sign in with Microsoft?** Using your M365 identity from the 
> start makes SSO wiring significantly cleaner — Tailscale 
> automatically registers as a multi-tenant gallery app in your 
> Entra tenant on first admin login. No manual app registration 
> required.

3. Tailscale auto-enrolls in a 14-day Premium trial
4. After the trial, subscribe to **Premium** (~$18 USD/month)

### 1.4 Disable Security Defaults

Entra enables Security Defaults on all new tenants. This **must** be 
disabled before custom Conditional Access policies can be applied — 
they cannot coexist.

1. Go to **Entra admin centre** → **Entra ID** → **Overview** → 
   **Properties**
2. Click **Manage security defaults**
3. Set **Security defaults** to **Disabled**
4. Click **Save**

> **Why:** Security Defaults and custom Conditional Access policies 
> cannot coexist in the same tenant. Since TinyCo operates on an E5 
> licence with full Conditional Access capabilities, Security Defaults 
> are disabled in favour of more granular, auditable custom policies.

---

## Step 2 — Local Environment Setup

### 2.1 Install Git

1. Download from **git-scm.com/download/win** — select 64-bit installer
2. During install:
   - Default editor → **Visual Studio Code**
   - Initial branch name → **main**
   - Leave all other options as default
3. Verify in a new terminal:
```bash
git --version
```

Expected: `git version 2.x.x`

### 2.2 Configure Git Identity
```bash
git config --global user.name "Will Chang"
git config --global user.email "WCTinyCoLab@outlook.com"
```

### 2.3 Install Azure CLI

1. Download from **aka.ms/installazurecliwindowsx64**
2. Run installer — all defaults
3. Verify in a new terminal:
```bash
az --version
```

### 2.4 Install Terraform

1. Download from **developer.hashicorp.com/terraform/install** → 
   Windows AMD64
2. Extract the zip — contains a single `terraform.exe`
3. Create folder `C:\terraform` and move `terraform.exe` there
4. Add to PATH:
   - `Windows key` → **Environment Variables**
   - **System variables** → **Path** → **Edit** → **New** → 
     type `C:\terraform`
5. Verify in a new terminal:
```bash
terraform --version
```

### 2.5 Install VS Code + Terraform Extension

1. Download from **code.visualstudio.com**
2. During install — check both **"Open with Code"** context menu 
   options and **"Add to PATH"**
3. After install → Extensions (`Ctrl+Shift+X`) → search 
   **HashiCorp Terraform** → Install

---

## Step 3 — Clone Repository & Authenticate

### 3.1 Clone the Repository
```bash
cd ~/Desktop
git clone https://github.com/willshchang/WSHC-Entra-IaC-Zero-Trust-Lab.git
cd WSHC-Entra-IaC-Zero-Trust-Lab
code .
```

### 3.2 Authenticate Azure CLI

> **Important:** Run this at the start of every working session. 
> Azure CLI sessions expire and require re-authentication. Always 
> authenticate before running any Terraform commands.
```bash
az login --tenant "42a9915e-aa4a-4426-9a86-a04a0dac6222" \
  --scope "https://graph.microsoft.com/.default"
```

Your browser will open — sign in with your Entra admin account and 
complete MFA (Multi-Factor Authentication) when prompted.

Verify:
```bash
az account show
```

Confirm `tenantDefaultDomain` shows `TinyCoDDG.onmicrosoft.com`

---

## Step 4 — Prepare HR Data

The Terraform code reads employee and team data from two CSV 
(Comma-Separated Values) files stored locally. These files are 
gitignored and never committed to version control — they contain 
personal information that must stay private.

### 4.1 Place Raw HR Files in the Dropzone

Place your HR CSV exports in the `incoming/` folder:
- Employee roster CSV (any filename containing "employee")
- Teams CSV (any filename containing "team")

### 4.2 Run the ETL Pipeline

The ETL (Extract, Transform, Load) pipeline cleans the raw files 
and stages them for Terraform:
```bash
chmod +x scripts/00-hr-data-etl.sh
./scripts/00-hr-data-etl.sh
```

**What this script does:**
- Removes the UTF-8 BOM (Byte Order Mark) Windows adds to CSV files — 
  this invisible character causes Terraform's `csvdecode()` to fail
- Standardises column headers to the format Terraform expects
- Moves clean files to `data/` ready for Terraform ingestion
- Removes the raw files from `incoming/`

### 4.3 Required CSV Format

The ETL script enforces these headers automatically. For reference:

**`data/employees.csv`:**
first_name,last_name,team
Paula,Humphrey,Backend
Emmy,Dillon,Backend

**`data/teams.csv`:**
team,applications,role_requirements
ITOps,"Asana,Tailscale,Tableau",Administrate the entire tenant
SRE,"Asana,Tailscale,Tableau",Administrate Azure cloud resources

### 4.4 Verify Data is Gitignored
```bash
git status
```

Confirm `data/employees.csv` and `data/teams.csv` do **not** appear 
in the output. If they do, check `.gitignore` contains:
data/
incoming/

---

## Step 5 — Configure Terraform Variables

### 5.1 Create `terraform.tfvars`

Navigate to the terraform folder and create the variables file:
```bash
cd ~/Desktop/WC-TinyCo-Entra-Migration/terraform
```

Create a new file named `terraform.tfvars` with the following 
content — replace all placeholder values:
```hcl
# Core Azure credentials
tenant_id       = "YOUR_TENANT_ID"
subscription_id = "YOUR_SUBSCRIPTION_ID"
admin_password  = "YOUR_CHOSEN_PASSWORD"

# Company identity
company_name = "TinyCo"
domain_name  = "TinyCoDDG.onmicrosoft.com"

# Admin accounts
primary_admin_upn     = "WC@TinyCoDDG.onmicrosoft.com"
grader_account_prefix = "admin.test"

# Entra ID directory roles
entra_role_map = {
  "ITOps"    = "62e90394-69f5-4237-9190-012177145e10"
  "Security" = "729827e3-9c14-49f7-bb1b-9608f156bbb8"
}

# Azure subscription roles  
azure_role_map = {
  "SRE"     = "b24988ac-6180-42a0-ab88-20f7382dd24c"
  "Backend" = "acdd72a7-3385-48ef-bd42-f606fba81ae7"
}
```

**TinyCo reference values:**

| Item | Value |
|---|---|
| Tenant ID | `42a9915e-aa4a-4426-9a86-a04a0dac6222` |
| Subscription ID | `29923100-cb5f-44bc-aec9-1207134ba164` |
| Tenant Domain | `TinyCoDDG.onmicrosoft.com` |

> **Security note:** `terraform.tfvars` is listed in `.gitignore` 
> and will never be pushed to GitHub. It contains sensitive 
> credentials and must be kept local at all times.

---

## Step 6 — Deploy the Environment

### 6.1 Initialize Terraform
```bash
terraform init
```

Expected: `Terraform has been successfully initialized!`

### 6.2 Format and Validate
```bash
terraform fmt
terraform validate
```

`terraform fmt` fixes any formatting inconsistencies.  
`terraform validate` checks for syntax errors without connecting 
to Azure.

Expected: `Success! The configuration is valid.`

### 6.3 Review the Plan
```bash
terraform plan
```

Review every resource that will be created. Expected summary 
(approximate):
Plan: ~254 to add, 0 to change, 0 to destroy

### 6.4 Apply the Configuration
```bash
terraform apply
```

Type `yes` when prompted. Takes approximately 3–5 minutes.

Expected: `Apply complete! Resources: X added, 0 changed, 0 destroyed`

> **Note:** If the apply is interrupted, run `terraform apply` again. 
> Terraform is idempotent — it only creates what is missing and 
> never duplicates existing resources.

---

## Step 7 — Configure Applications

The four core applications require one manual configuration step 
each after Terraform creates their Entra registrations. This is 
the documented IaC (Infrastructure as Code) boundary — Terraform 
manages the Entra side, the manual step completes the SP 
(Service Provider) side handshake.

### 7.1 Tailscale

Tailscale auto-registers in Entra when an admin signs in using 
Microsoft identity. No additional SSO configuration required.

**Verify:** Go to **tailscale.com/admin** → **Settings** → 
**User Management** → confirm Identity Provider shows **Microsoft**.

### 7.2 Mattermost

Mattermost runs on the Azure VM and is accessible only via 
Tailscale VPN. SAML SSO is configured using Tailscale Serve 
for HTTPS termination.

**Prerequisites:** Azure VM must be running and Tailscale connected.

Full setup documented in: 
[Mattermost SSO Troubleshooting](./troubleshooting/mattermost-sso-troubleshooting.md)

**Access URL:** `https://tinyco-vm.hair-squeaker.ts.net/tinycoddg`

### 7.3 Tableau Cloud

1. **Entra admin centre** → **Enterprise Applications** → 
   find Tableau Cloud app
2. **Single sign-on** → **SAML** → configure using metadata exchange
3. In **Tableau Cloud** → **Settings** → **Authentication** → 
   upload Entra Federation Metadata XML

Full setup documented in:
[Tableau SSO Troubleshooting](./troubleshooting/tableau-sso-troubleshooting.md)

**SSO URL:** `https://sso.online.tableau.com/public/idp/SSO`

### 7.4 Elastic Cloud

1. In **Elastic Cloud** → create a **Cloud Hosted** deployment 
   (not Serverless — Serverless requires org-level SSO with 
   custom domain verification)
2. Go to **Stack Management** → **Security** → **SAML**
3. Configure using Entra SAML metadata

> **Important:** Use Cloud Hosted, not Serverless. Serverless 
> requires domain verification for organisation-level SSO. 
> Cloud Hosted supports deployment-level SSO without a custom domain.

---

## Step 8 — Verify the Environment

| Check | Location | Expected |
|---|---|---|
| Users | Entra → Users | 91 users (89 employees + admin + break-glass) |
| Groups | Entra → Groups | 11+ groups (9 TinyCo dynamic + admin static groups) |
| Enterprise Apps | Entra → Enterprise Applications | 14 TinyCo apps visible |
| Conditional Access | Entra → Security → Conditional Access | 2 policies active |
| RBAC — ITOps | Entra → Roles | TinyCo-ITOps-Admins: Global Administrator |
| RBAC — SRE | Azure → Subscriptions → IAM | TinyCo-SRE: Contributor |
| Tailscale | tailscale.com/admin | tinyco-vm Connected, Exit Node active |
| Mattermost | Tailscale URL | Login page with Entra ID button |
| Tableau | SSO URL | Login redirects to Microsoft |
| Elastic | Kibana URL | Login with Microsoft button |

---

## Terraform File Reference

| File | Purpose |
|---|---|
| `providers.tf` | Azure and Entra provider versions |
| `variables.tf` | Variable definitions (no values) |
| `terraform.tfvars` | Actual values — gitignored, never on GitHub |
| `users.tf` | 89 employee accounts, CSV-driven with full attribute mapping |
| `groups.tf` | Dynamic team groups (ABAC) + static admin groups |
| `rbac.tf` | Azure and Entra role assignments + app access matrix |
| `conditional-access.tf` | MFA policy + legacy auth block + break-glass account |
| `tailscale.tf` | Tailscale service principal reference |
| `mattermost.tf` | Mattermost custom SAML app registration |
| `tableau.tf` | Tableau Cloud SAML app registration |
| `elastic.tf` | Elastic Cloud SAML app registration |
| `apps-stub.tf` | 10 stub registrations for remaining apps |

---

## Important Reference IDs

| Item | Value |
|---|---|
| Tenant ID | `42a9915e-aa4a-4426-9a86-a04a0dac6222` |
| Subscription ID | `29923100-cb5f-44bc-aec9-1207134ba164` |
| Tenant Domain | `TinyCoDDG.onmicrosoft.com` |
| Admin Account | `WC@TinyCoDDG.onmicrosoft.com` |
| Break-glass Account | `admin.test@TinyCoDDG.onmicrosoft.com` |
| VM Public IP | `20.63.73.34` |
| VM Tailscale IP | `100.83.194.101` |
| Tailscale Hostname | `tinyco-vm.hair-squeaker.ts.net` |
| Break-glass Password | Delivered via submission notes |