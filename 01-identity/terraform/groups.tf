# groups.tf
# This file manages the creation of Security Groups in Entra ID.

# ============================================================
# DATA DISCOVERY (ZERO-HARDCODE ARCHITECTURE)
# ============================================================
# We do not hardcode team names (like "ITOps" or "SRE"). 
# Instead, we look at the raw HR data parsed in users.tf and 
# dynamically build a list of whatever teams happen to exist.
# ============================================================

locals {
  # 1. Look at 'local.employees_raw' (which terraform loaded in users.tf)
  # 2. Extract every single 'team' value from that CSV.
  # 3. Use 'distinct()' to filter out duplicates, leaving a clean list of unique departments.
  unique_teams = distinct([for emp in local.employees_raw : emp.team])

  # The one team name the code must know: the primary admin joins
  # this team's static admin group below. variables.tf validates
  # that entra_role_map has this key, so keep the two in sync.
  admin_team = "ITOps"
}

# ============================================================
# ROLE MAP SANITY CHECK (WARNING ONLY)
# ============================================================
# rbac.tf and the admin group bridge silently skip role map keys
# that match no CSV team, so a typo ("SecOps" for "Security")
# would quietly grant nothing. This check prints a warning in
# plan and apply without blocking them.
# ============================================================

check "role_map_teams" {
  assert {
    condition = alltrue([
      for team in concat(keys(var.entra_role_map), keys(var.azure_role_map)) :
      contains(local.unique_teams, team)
    ])
    error_message = "entra_role_map or azure_role_map has a key that matches no team in data/employees.csv. Role map keys must match CSV team names exactly."
  }
}

# ============================================================
# DYNAMIC GROUP CREATION (THE "SELF-HEALING" LAYER)
# ============================================================
# Instead of Terraform manually writing names onto a guest list (Static),
# we tell Entra ID to enforce a dress code (Dynamic).
# If a user's department attribute matches the group name, they are in.
#
# LICENSING: dynamic membership needs Entra ID P1 for every member.
# The tenant is on Entra ID Free since the E5 trial ended, so
# membership rules are not a feature it is licensed for. See the
# licensing matrix in 01-identity/README.md.
# https://learn.microsoft.com/en-us/entra/identity/users/groups-dynamic-membership#license-requirements
# ============================================================

resource "azuread_group" "teams" {
  # Loop through our dynamically generated list of unique teams
  for_each = toset(local.unique_teams)

  # Uses the variable so no company name is hardcoded
  display_name     = "${var.company_name}-${each.value}"
  security_enabled = true

  # THE DYNAMIC ENGINE:
  # Activating this type hands the user-management workload over to Azure's internal engine.
  types = ["DynamicMembership"]

  # The Rule: "If the user's Entra 'department' field equals this group's name, add them."
  # enabled = true turns rule processing on for the group.
  dynamic_membership {
    enabled = true
    rule    = "(user.department -eq \"${each.value}\")"
  }
}

# ============================================================
# THE "VIP" EXCLUSION GROUP (SECURITY LAYER)
# ============================================================
# This group is used specifically to bypass MFA and Legacy Auth.
# Unlike the team groups, this MUST remain Static. Access to bypass 
# security should always require deliberate, manual human intervention.
# ============================================================

resource "azuread_group" "security_exclusion" {
  display_name     = "Security-Exclusion-Emergency"
  security_enabled = true
  description      = "Generic exclusion group for security policy bypass (break-glass emergency access)."
}

# Place the break-glass account into the exclusion group
resource "azuread_group_member" "breakglass_access" {
  group_object_id  = azuread_group.security_exclusion.object_id
  member_object_id = azuread_user.breakglass.object_id
}

# Resource renamed from grader_access to breakglass_access.
# WHY: the moved block tells Terraform this is the same group
# membership under a new name, so it updates state instead of
# deleting and recreating the break-glass exclusion.
moved {
  from = azuread_group_member.grader_access
  to   = azuread_group_member.breakglass_access
}

# ============================================================
# PRIVILEGED ADMIN GROUPS (STATIC)
# ============================================================
# Microsoft requires groups holding Entra Roles to be Static.
# We generate these dynamically based on the tfvars role map.

resource "azuread_group" "admin_groups" {
  for_each = var.entra_role_map

  display_name     = "${var.company_name}-${each.key}-Admins (Static)"
  security_enabled = true

  # This is the magic key that allows Entra Role assignment
  assignable_to_role = true
}

# ============================================================
# THE BRIDGE: POPULATING THE STATIC ADMIN GROUPS
# ============================================================
# Because we cannot assign Entra roles to Dynamic groups, we must 
# explicitly place the admin users (ITOps/Security) from our CSV 
# into their respective Static groups.

# 1. Loop through the CSV users and add them if they belong to an admin team
resource "azuread_group_member" "csv_admin_members" {
  # Filter the employee list to ONLY include people in ITOps or Security
  for_each = {
    for key, emp in local.employees : key => emp
    if contains(keys(var.entra_role_map), emp.team)
  }

  group_object_id  = azuread_group.admin_groups[each.value.team].object_id
  member_object_id = azuread_user.employees[each.key].object_id
}

# 2. Add YOU (The Primary Admin) to the Static ITOps Group
# Since you were created outside the CSV, we map you explicitly.
resource "azuread_group_member" "primary_admin_itops" {
  group_object_id  = azuread_group.admin_groups[local.admin_team].object_id
  member_object_id = data.azuread_user.primary_admin.object_id
}