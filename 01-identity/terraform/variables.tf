# variables.tf
# This file defines all the input variables Terraform needs to connect to Azure.
# Think of it as the "settings panel" — no resources are created here.
# The actual values are stored in terraform.tfvars (which never goes to GitHub).
#
# DEPLOYMENT HISTORY
# This layer was deployed and validated on the tenant
# TinyCoDDG.onmicrosoft.com during the Microsoft 365 E5 trial
# (late spring 2026). The trial has since ended. No tenant
# values are hardcoded here, so the same code deploys to any
# tenant by changing terraform.tfvars.

variable "tenant_id" {
  description = "The unique ID of your Azure/Entra tenant"
  type        = string
}

variable "subscription_id" {
  description = "The Azure subscription ID where resources will be created"
  type        = string
}

variable "admin_password" {
  description = "Initial password for new CSV employee accounts. Used at creation only (users.tf ignores later changes). Never used for the break-glass account."
  type        = string
  sensitive   = true
}

# ============================================================
# BREAK-GLASS PASSWORD
# ============================================================
# A separate secret for the emergency access account, stored
# offline by the owner. WHY separate: the shared employee initial
# password is known to everyone who was onboarded with it.
# users.tf also refuses a value equal to admin_password.
# ============================================================

variable "breakglass_password" {
  description = "Password for the break-glass account. At least 16 characters, different from admin_password."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.breakglass_password) >= 16
    error_message = "breakglass_password must be at least 16 characters long."
  }
}

# ============================================================
# ROSTER SAFETY THRESHOLD
# ============================================================
# Removing a CSV row deletes the account, so a truncated CSV is
# dangerous. If the roster has fewer rows than this number, the
# plan stops (see terraform_data.roster_guard in users.tf).
# Set it to roughly 90% of the current headcount and lower it on
# purpose when the company really shrinks.
# ============================================================

variable "min_expected_employees" {
  description = "Minimum number of rows data/employees.csv must contain before Terraform will plan"
  type        = number
  default     = 80

  validation {
    condition     = var.min_expected_employees >= 1 && floor(var.min_expected_employees) == var.min_expected_employees
    error_message = "min_expected_employees must be a whole number of at least 1."
  }
}

# ============================================================
# ORGANIZATION SETTINGS
# ============================================================
# These variables act as the "Master Switch" for the company identity.
# By referencing these variables in other files, our Terraform code 
# remains 100% generic and portable. If TinyCo changes its name tomorrow, 
# we only update the tfvars file, not the underlying logic.

variable "company_name" {
  description = "The official name of the organization (e.g., TinyCo)"
  type        = string
}

variable "domain_name" {
  description = "The primary Entra ID domain (e.g., <tenant>.onmicrosoft.com)"
  type        = string
}

# ============================================================
# ROLE MAPPING BUCKETS (ZERO-HARDCODE ARCHITECTURE)
# ============================================================
# These variables define the structure for our RBAC system. 
# They act as empty containers. The actual team names (e.g., "ITOps") 
# and their Role IDs are injected securely at runtime via terraform.tfvars.

variable "entra_role_map" {
  description = "A map linking Team Names to Entra ID role template IDs. Must include ITOps."
  type        = map(string)

  # groups.tf adds the primary admin to the ITOps admin group
  # (local.admin_team), so a map without "ITOps" would fail late
  # with an index error. Keep this literal in sync with
  # local.admin_team in groups.tf.
  validation {
    condition     = contains(keys(var.entra_role_map), "ITOps")
    error_message = "entra_role_map must contain an \"ITOps\" key (see local.admin_team in groups.tf)."
  }
}

variable "azure_role_map" {
  description = "A map linking Team Names to Azure Resource Role GUIDs"
  type        = map(string)
  default     = {}
}

# ============================================================
# EXISTING ADMIN REFERENCE
# ============================================================
# This tells Terraform to expect the email address of the 
# existing admin, but doesn't reveal what it is

variable "primary_admin_upn" {
  description = "The User Principal Name (email) of the existing Global Admin account"
  type        = string
}

# ============================================================
# BREAK GLASS ACCOUNT NAME
# ============================================================
# The username prefix of the break-glass account. users.tf splits
# it at the dot into first and last name, so it must contain
# exactly one dot with text on both sides.

variable "breakglass_account_prefix" {
  description = "The username prefix for the emergency access (break-glass) account (e.g., breakglass.admin)"
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$", var.breakglass_account_prefix))
    error_message = "breakglass_account_prefix must look like first.last (letters, digits, underscores or hyphens, exactly one dot), e.g. breakglass.admin."
  }
}

# ============================================================
# APP RETURN URL BUCKET (SAML HANDSHAKE LAYER)
# ============================================================
# This map stores the base URLs or FQDNs for our internal apps.
# By centralizing these, we can dynamically build the Redirect
# and Identifier URIs across the environment.

variable "app_urls" {
  description = "A map linking App Keys to their primary FQDNs (e.g., Tailscale addresses)"
  type        = map(string)
  # No default: these are real endpoints, so they live in the
  # gitignored terraform.tfvars. Example:
  # app_urls = {
  #   "mattermost" = "tinyco-vm.<tailnet>.ts.net"
  #   "tableau"    = "<site-id>/<idp-id>"
  #   "elastic"    = "<deployment>.kb.<region>.azure.elastic-cloud.com"
  # }
}