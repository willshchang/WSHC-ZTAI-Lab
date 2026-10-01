# conditional-access.tf
# Defines and enforces security policies for the tenant.
#
# Conditional Access is Entra's "if this, then that" security engine.
#
# IMPORTANT: Security Defaults must be disabled in the Azure Portal
# before these policies can take effect.
#
# LICENSING: Conditional Access needs Entra ID P1. The tenant is on
# Entra ID Free since the E5 trial ended. Microsoft keeps existing
# policies in place when the license expires, but they can only be
# viewed or deleted, not updated. Any change to these two resources
# will therefore fail on apply until P1 is back.
# https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview#license-requirements

# ============================================================
# POLICY 1 — Require MFA (With Group Exclusion)
# ============================================================
# Forces MFA for everyone in the tenant, EXCEPT members of our
# dedicated emergency exclusion group.

resource "azuread_conditional_access_policy" "require_mfa" {
  # Dynamically names the policy based on the tfvars file
  display_name = "${var.company_name} - Require MFA for All Users"
  state        = "enabled"

  conditions {
    client_app_types = ["all"]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users = ["All"]

      # THE ENTERPRISE PIVOT: 
      # We target the Group ID from groups.tf, not the User ID.
      excluded_groups = [azuread_group.security_exclusion.object_id]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["mfa"]
  }
}

# ============================================================
# POLICY 2 — Block Legacy Authentication (With Group Exclusion)
# ============================================================
# Closes a major attack vector by blocking old email protocols 
# that cannot prompt for MFA.

resource "azuread_conditional_access_policy" "block_legacy_auth" {
  display_name = "${var.company_name} - Block Legacy Authentication"
  state        = "enabled"

  conditions {
    client_app_types = [
      "exchangeActiveSync",
      "other"
    ]

    applications {
      included_applications = ["All"]
    }

    users {
      included_users = ["All"]

      # Break-glass account is excluded so an emergency admin can never be locked out
      excluded_groups = [azuread_group.security_exclusion.object_id]
    }
  }

  grant_controls {
    operator          = "OR"
    built_in_controls = ["block"]
  }
}