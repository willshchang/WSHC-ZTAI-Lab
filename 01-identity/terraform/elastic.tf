# ============================================================
# 1. IDENTITY: The Custom Application Registration
# ============================================================
resource "azuread_application" "elastic" {
  display_name = "${var.company_name}-Elastic-SAML"

  # [SAML IDENTIFIER / ENTITY ID]
  # Using the dynamic map. Note the trailing slash to match your portal state.
  identifier_uris = ["https://${var.app_urls["elastic"]}/"]

  # REQUIRED: The Standard User role for your RBAC matrix.
  app_role {
    allowed_member_types = ["User"]
    description          = "Standard Access to Elastic"
    display_name         = "Standard User"
    enabled              = true
    id                   = "33333333-3333-3333-3333-333333333333"
    value                = "User"
  }

  web {
    # [SAML REDIRECT / REPLY URL]
    # This is the dedicated Kibana callback path.
    # Defining this here stops Terraform from trying to delete it.
    redirect_uris = ["https://${var.app_urls["elastic"]}/api/security/saml/callback"]
  }
}

# ============================================================
# 2. ENFORCEMENT: The Enterprise Application (Service Principal)
# ============================================================
resource "azuread_service_principal" "elastic" {
  client_id                     = azuread_application.elastic.client_id
  preferred_single_sign_on_mode = "saml"

  feature_tags {
    enterprise            = true
    custom_single_sign_on = true
  }
}