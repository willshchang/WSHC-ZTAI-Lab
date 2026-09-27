# ============================================================
# USER DATA INGESTION (HRCM LAYER)
# ============================================================
# This section treats our local CSV file like an API response from an 
# HR system (like ADP). It reads the file and structures the data 
# so Terraform can loop through it to build accounts dynamically.

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
# ENTRA ID USER PROVISIONING
# ============================================================
# Create one Entra user account per employee found in the CSV.
# This block now fully maps First, Last, and Email attributes.

resource "azuread_user" "employees" {
  for_each = local.employees

  # [ID & IDENTITY]
  # Username format: firstname.lastname@TinyCoDDG.onmicrosoft.com
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

  # [SECURITY DEFAULTS]
  # Apply the standard admin password but force the user to change it 
  # to a private password immediately on first login.
  password              = var.admin_password
  force_password_change = true
  account_enabled       = true
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
# BREAK-GLASS / GRADER TESTING ACCOUNT (DYNAMIC NAME)
# ============================================================
# This resource uses string functions to split the prefix (e.g., "admin.test")
# into First and Last names, ensuring NO hardcoded strings exist.

resource "azuread_user" "breakglass" {
  user_principal_name = "${var.grader_account_prefix}@${var.domain_name}"
  mail_nickname       = var.grader_account_prefix

  # Dynamically split "admin.test" into "Admin" and "Test"
  # title() capitalizes the first letter; split() breaks the string at the dot
  display_name = title(replace(var.grader_account_prefix, ".", " "))
  given_name   = title(split(".", var.grader_account_prefix)[0])
  surname      = title(split(".", var.grader_account_prefix)[1])

  mail = "${var.grader_account_prefix}@${var.domain_name}"

  # Password & Security Settings
  password              = var.admin_password
  force_password_change = false
  account_enabled       = true

  # Organization Mapping
  company_name = var.company_name
  department   = "ITOps" # Required for your admin group mapping
}