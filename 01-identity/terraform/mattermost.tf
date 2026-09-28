# ============================================================
# 1. IDENTITY: The Custom Application Registration
# ============================================================
# This is the "Identity Identity." We define a "Standard User" 
# role here so that your Security Groups have a valid 
# permission to hold onto.
resource "azuread_application" "mattermost" {
  display_name = "${var.company_name}-Mattermost-SAML"

  # [SAML IDENTIFIER / ENTITY ID]
  # This is the "Audience" string that identifies this specific app.
  # It must match the "Service Provider Identifier" in the Mattermost Console.
  identifier_uris = ["https://${var.app_urls["mattermost"]}"]

  # REQUIRED: This creates the "User" permission in Entra ID.
  # Our RBAC matrix uses this ID to grant access to your teams.
  app_role {
    allowed_member_types = ["User"]
    description          = "Standard Access to Mattermost"
    display_name         = "Standard User"
    enabled              = true
    id                   = "22222222-2222-2222-2222-222222222222"
    value                = "User"
  }

  # This signals to Azure that this is a Web application.
  web {
    # [SAML REDIRECT / REPLY URL]
    # This is where Entra ID sends the encrypted token after a 
    # successful login. If this is missing, the SAML button fails.
    # Defining this here prevents the "defaultRedirectUri" 400 error.
    redirect_uris = ["https://${var.app_urls["mattermost"]}/login/sso/saml"]
  }
}

# ============================================================
# 2. ENFORCEMENT: The Enterprise Application (Service Principal)
# ============================================================
# This is the "Local Instance" of Mattermost. It links the global 
# registration above to your specific TinyCo tenant.
resource "azuread_service_principal" "mattermost" {
  client_id                     = azuread_application.mattermost.client_id
  preferred_single_sign_on_mode = "saml"

  feature_tags {
    enterprise            = true
    custom_single_sign_on = true
  }
}