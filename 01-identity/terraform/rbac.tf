# ============================================================
# DATA DISCOVERY: SUBSCRIPTION CONTEXT
# ============================================================
# Retrieves the current active Azure subscription ID automatically.
data "azurerm_subscription" "current" {}

# ============================================================
# STATIC ROLE ASSIGNMENTS (DATA-BLIND LOGIC)
# ============================================================
# [1] Assign Entra ID Roles (Tenant-Level Admin Powers)
# We point to the STATIC admin_groups created in groups.tf
resource "azuread_directory_role_assignment" "entra_roles" {
  for_each = var.entra_role_map

  role_id             = each.value
  principal_object_id = azuread_group.admin_groups[each.key].object_id
}

# [2] Assign Azure Resource Roles (Cloud Infrastructure Powers)
resource "azurerm_role_assignment" "azure_roles" {
  for_each = {
    for team, role_id in var.azure_role_map :
    team => role_id if contains(keys(azuread_group.teams), team)
  }

  scope              = data.azurerm_subscription.current.id
  role_definition_id = "/subscriptions/${data.azurerm_subscription.current.subscription_id}/providers/Microsoft.Authorization/roleDefinitions/${each.value}"
  principal_id       = azuread_group.teams[each.key].object_id
}

# ============================================================
# THE APP ROLE MAPPINGS: Linking Apps to their IDs and Roles
# ============================================================
# Grants every dynamic team access to the core enterprise applications
# using specific, hardcoded App Role IDs to bypass API rejections.
# We use 'locals' to create lookup tables. This keeps the assignment 
# loop clean and tells Terraform exactly where to find the IDs.

locals {
  # 1. Targets: Map the App Names to their Enterprise App Object IDs
  apps_to_assign = {
    "Tailscale"  = data.azuread_service_principal.tailscale.object_id
    "Mattermost" = azuread_service_principal.mattermost.object_id
    "Elastic"    = azuread_service_principal.elastic.object_id
    "Tableau"    = azuread_service_principal.tableau.object_id
  }

  # 2. The Keys: Map the App Names to their specific Permission Locks (App Roles)
  app_role_ids = {
    # Tailscale is a Gallery App with no custom roles, so we use the Entra ID "Default Access" lock
    "Tailscale" = "18d14569-c3bd-439b-9a66-3a2aee01d14f"

    # Custom apps use the explicit locks we built
    "Mattermost" = "22222222-2222-2222-2222-222222222222"
    "Elastic"    = "33333333-3333-3333-3333-333333333333"
    "Tableau"    = "44444444-4444-4444-4444-444444444444"
  }

  # 3. The Matrix Engine: Multiplies every Team by every App
  group_app_pairs = {
    for pair in setproduct(keys(azuread_group.teams), keys(local.apps_to_assign)) :
    "${pair[0]}-${pair[1]}" => {
      group_id = azuread_group.teams[pair[0]].object_id
      app_id   = local.apps_to_assign[pair[1]]
      role_id  = local.app_role_ids[pair[1]]
    }
  }
}

# ============================================================
# ENFORCEMENT: The Bulk Role Assignment Loop
# ============================================================
# This loop executes 36 times (once for every group/app combo).
# It grabs the correct Group, App, and Role, and binds them together.
# 4. The Action: Executes the 36 assignments using the Matrix data

resource "azuread_app_role_assignment" "app_access" {
  for_each = local.group_app_pairs

  principal_object_id = each.value.group_id
  resource_object_id  = each.value.app_id
  app_role_id         = each.value.role_id
}