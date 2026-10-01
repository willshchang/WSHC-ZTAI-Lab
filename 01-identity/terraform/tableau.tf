# ============================================================
# 1. IDENTITY: The Custom Application Registration
# ============================================================
# This creates the Identity for Tableau. By defining our own 
# "Standard User" role, we ensure the RBAC matrix in rbac.tf 
# has a valid ID to target, preventing "Permission Not Found" errors.
resource "azuread_application" "tableau" {
  display_name = "${var.company_name}-Tableau-Cloud"

  # [SAML IDENTIFIER / ENTITY ID]
  # Using interpolation to build the exact metadata URL
  identifier_uris = ["https://sso.online.tableau.com/public/sp/metadata/${var.app_urls["tableau"]}"]

  # REQUIRED: This creates the "User" permission.
  # We use a unique UUID for Tableau so it stays distinct in your logs.
  app_role {
    allowed_member_types = ["User"]
    description          = "Standard Access to Tableau"
    display_name         = "Standard User"
    enabled              = true
    id                   = "44444444-4444-4444-4444-444444444444"
    value                = "User"
  }

  # This anchor signals this is a web-based service.
  web {
    # [SAML REDIRECT / REPLY URL]
    # Building the SSO path to match your manual fix
    redirect_uris = ["https://sso.online.tableau.com/public/sp/SSO/${var.app_urls["tableau"]}"]

    # No implicit_grant block: Tableau signs in with SAML, so the
    # OAuth 2.0 implicit flow (ID tokens in the browser URL) is
    # not needed and stays off.
  }
}

# ============================================================
# 2. ENFORCEMENT: The Enterprise Application (Service Principal)
# ============================================================
# This is the "Active Instance" of Tableau. We force the 
# SSO mode to SAML so the Single Sign-On menu is immediately 
# available in the Portal for your final handshake.
resource "azuread_service_principal" "tableau" {
  client_id                     = azuread_application.tableau.client_id
  preferred_single_sign_on_mode = "saml"

  # Only users and groups with an app role assignment (rbac.tf) can
  # get a token. The provider default is false, which lets any user
  # or guest in the tenant sign in. Group-based assignment needs
  # Entra ID P1: see the licensing matrix in 01-identity/README.md.
  # https://github.com/hashicorp/terraform-provider-azuread/blob/v2.53.1/docs/resources/service_principal.md
  app_role_assignment_required = true

  feature_tags {
    enterprise            = true
    custom_single_sign_on = true
  }
}