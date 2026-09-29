# jml.tf
# Static groups for the JML agent (Layer 3: 03-agents/jml).

# ============================================================
# WHY STATIC GROUPS
# ============================================================
# The team groups in groups.tf are DYNAMIC: Entra fills them from a
# rule, so nothing (not even an agent) can add members by hand. On
# Entra ID Free, dynamic rules also stop being processed. The JML
# agent therefore gets its own STATIC groups that it can manage.
#
# Code stays the source of truth: these groups are defined here,
# never clicked together in the portal. Users the agent creates are
# NOT in Terraform, and the agent refuses to touch Terraform users,
# so the two never fight over the same account.
# ============================================================

# One static group per team, from the same HR data as groups.tf
resource "azuread_group" "jml_teams" {
  for_each = toset(local.unique_teams)

  display_name     = "${var.company_name}-JML-${each.value}"
  security_enabled = true
  description      = "Static team group managed by the JML agent."
}

# Scope marker: the agent only manages members of this group
resource "azuread_group" "jml_managed" {
  display_name     = "${var.company_name}-JML-Managed"
  security_enabled = true
  description      = "Users the JML agent created and may manage. Everyone else is out of scope."
}

# Leavers land here: disabled, sessions revoked, kept for audit and legal hold
resource "azuread_group" "jml_terminated" {
  display_name     = "${var.company_name}-JML-Terminated"
  security_enabled = true
  description      = "Leavers processed by the JML agent. Disabled, never deleted."
}

# ============================================================
# OUTPUT: paste into 03-agents/jml/tenant.local.json
# ============================================================
# Run: terraform output -json jml_group_ids
# Protected groups are included so the agent refuses to touch
# break-glass and admin accounts.
# ============================================================
output "jml_group_ids" {
  description = "Group object IDs for the JML agent's tenant.local.json"
  value = {
    teams      = { for team, g in azuread_group.jml_teams : team => g.object_id }
    managed    = azuread_group.jml_managed.object_id
    terminated = azuread_group.jml_terminated.object_id
    protected = concat(
      [azuread_group.security_exclusion.object_id],
      [for g in azuread_group.admin_groups : g.object_id],
    )
  }
}
