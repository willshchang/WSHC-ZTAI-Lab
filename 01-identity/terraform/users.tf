# ============================================================
# USER DATA INGESTION (HRCM LAYER)
# ============================================================
# This section treats our local CSV file like an API response from an
# HR system (like ADP). It reads the file and structures the data
# so Terraform can loop through it to build accounts dynamically.
#
# IMPORTANT: the CSV is the roster. A row that disappears from the
# CSV makes Terraform DELETE that Entra account on the next apply
# (it is not disabled). See docs/admin/03-provisioning.md.

locals {
  # Read the CSV file and decode it into a list of employee objects.
  # Each row becomes a data package: { first_name, last_name, team }
  employees_raw = csvdecode(file("${path.module}/../data/employees.csv"))

  # Transform the raw list into a map keyed by "firstname.lastname".
  # This format is required by the for_each loop below and automatically
  # generates a standardized username prefix for every employee.
  employees = {
    for emp in local.employees_raw :
    "${lower(emp.first_name)}.${lower(emp.last_name)}" => emp
  }
}

# ============================================================
# ROSTER SAFETY CHECK
# ============================================================
# WHY: removing a row deletes the account. A truncated or empty
# CSV (bad export, wrong file, half-written copy) would therefore
# plan the deletion of most of the company in one apply.
#
# This precondition fails the whole plan when the roster has fewer
# rows than var.min_expected_employees, before anything is deleted.
# terraform_data keeps no remote object; it only exists to carry
# the check. Unlike a `check` block (warning only), a failed
# precondition blocks the apply.
# https://developer.hashicorp.com/terraform/language/expressions/custom-conditions#preconditions-and-postconditions
# ============================================================

resource "terraform_data" "roster_guard" {
  lifecycle {
    precondition {
      condition     = length(local.employees) >= var.min_expected_employees
      error_message = "The HR roster has ${length(local.employees)} employees, fewer than min_expected_employees (${var.min_expected_employees}). Removing rows deletes accounts, so the plan was stopped. Check data/employees.csv, or lower min_expected_employees if the headcount really dropped."
    }
  }
}

# ============================================================
# ENTRA ID USER PROVISIONING
# ============================================================
# Create one Entra user account per employee found in the CSV.
# This block now fully maps First, Last, and Email attributes.

resource "azuread_user" "employees" {
  for_each = local.employees

  # [ID & IDENTITY]
  # Username format: firstname.lastname@<tenant>.onmicrosoft.com
  user_principal_name = "${each.key}@${var.domain_name}"
  display_name        = "${each.value.first_name} ${each.value.last_name}"
  mail_nickname       = each.key

  # [MAPPING THE FULL NAME]
  # These are critical for Mattermost SSO and the Outlook Global Address List.
  given_name = each.value.first_name
  surname    = each.value.last_name
  mail       = "${each.key}@${var.domain_name}"

  # [ATTRIBUTE ENRICHMENT]
  # Map the CSV 'team' column to both job_title and department.
  # This ensures that downstream SaaS apps have standardized data points.
  job_title    = each.value.team
  department   = each.value.team
  company_name = var.company_name

  # [INITIAL PASSWORD]
  # Lab shortcut: every new account starts with the same initial
  # password and must change it at first sign-in. In production,
  # issue each user a one-time Temporary Access Pass instead:
  # https://learn.microsoft.com/en-us/entra/identity/authentication/howto-authentication-temporary-access-pass
  password              = var.admin_password
  force_password_change = true
  account_enabled       = true

  lifecycle {
    # WHY: the password is only an initial secret. Without this,
    # changing var.admin_password would reset the password of
    # every employee on the next apply, including users who
    # already chose their own.
    ignore_changes = [password]
  }
}

# ============================================================
# EXISTING ADMIN REFERENCE (DATA-BLIND)
# ============================================================
# Reference the existing Global Admin account to allow role
# assignments or group memberships without Terraform trying to
# recreate the user. Sourced securely from tfvars.

data "azuread_user" "primary_admin" {
  user_principal_name = var.primary_admin_upn
}

# ============================================================
# BREAK-GLASS EMERGENCY ACCESS ACCOUNT (DYNAMIC NAME)
# ============================================================
# Follows Microsoft's emergency access guidance:
# https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access
#
# - Own password (var.breakglass_password), never the shared
#   employee password.
# - No department, so it never lands in a dynamic team group and
#   never inherits team app access or Azure roles.
# - Global Administrator assigned directly and permanently below
#   (active, not PIM-eligible).
# - prevent_destroy stops a bad plan from deleting it.
#
# Manual steps Terraform cannot do (see docs/admin/02-security-model.md):
# register a FIDO2 passkey or certificate-based auth (required for
# admin portals under Microsoft's mandatory MFA) and set up a
# sign-in alert for this account.
#
# The prefix (e.g. "breakglass.admin") is split at the dot into
# first and last name, so no names are hardcoded here.

resource "azuread_user" "breakglass" {
  user_principal_name = "${var.breakglass_account_prefix}@${var.domain_name}"
  mail_nickname       = var.breakglass_account_prefix

  # Split "breakglass.admin" into "Breakglass" and "Admin".
  # title() capitalizes the first letter; split() breaks the string at the dot.
  # var.breakglass_account_prefix is validated to contain exactly one dot.
  display_name = title(replace(var.breakglass_account_prefix, ".", " "))
  given_name   = title(split(".", var.breakglass_account_prefix)[0])
  surname      = title(split(".", var.breakglass_account_prefix)[1])

  mail = "${var.breakglass_account_prefix}@${var.domain_name}"

  # Password is set by the owner and stored offline, so no forced
  # change at next sign-in.
  password              = var.breakglass_password
  force_password_change = false
  account_enabled       = true

  # Organization Mapping
  # department is deliberately NOT set. The dynamic team groups
  # match on department, and ITOps would hand this account every
  # SSO app plus the ITOps Azure roles.
  company_name = var.company_name

  lifecycle {
    prevent_destroy = true

    precondition {
      condition     = var.breakglass_password != var.admin_password
      error_message = "breakglass_password must be different from admin_password (the shared employee initial password)."
    }
  }
}

# ============================================================
# BREAK-GLASS GLOBAL ADMINISTRATOR (PERMANENT, ACTIVE)
# ============================================================
# 62e90394-69f5-4237-9190-012177145e10 is the Global Administrator
# role template ID:
# https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/permissions-reference#global-administrator
#
# Assigned directly to the user, not through a group, so it does
# not depend on group membership or PIM.
#
# ALREADY ASSIGNED BY HAND? Import it before the first apply,
# otherwise Entra rejects the duplicate assignment. The import ID
# is the role assignment ID (azuread 2.53.1 docs):
# https://github.com/hashicorp/terraform-provider-azuread/blob/v2.53.1/docs/resources/directory_role_assignment.md#import
# See docs/admin/02-security-model.md for how to look it up.
#
# import {
#   to = azuread_directory_role_assignment.breakglass_global_admin
#   id = "<role-assignment-id>"
# }

resource "azuread_directory_role_assignment" "breakglass_global_admin" {
  role_id             = "62e90394-69f5-4237-9190-012177145e10"
  principal_object_id = azuread_user.breakglass.object_id
}
