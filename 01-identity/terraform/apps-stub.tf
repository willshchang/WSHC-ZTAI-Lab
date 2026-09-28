# apps-stub.tf
# Stub registrations for remaining TinyCo applications.
# These apps are registered in Entra to establish their identity
# but are not fully configured in this project scope.
#
# A stub registration means:
# - The app exists in Entra and can be found by admins
# - SSO and provisioning configuration is done manually in the portal
# - Groups are not assigned yet — done when each app is fully configured
#
# Production next steps for each app:
# - Configure SAML SSO settings in Entra portal
# - Obtain SSO metadata from each app vendor
# - Assign appropriate groups per teams_db.csv

locals {
  stub_apps = {
    "Asana"        = "All teams use Asana as primary project management tool"
    "Figma"        = "Design, Frontend, Product, ITOps teams"
    "Zoom"         = "All teams use Zoom for synchronous communication"
    "Adobe"        = "Design, Product, People Ops, Legal teams"
    "PagerDuty"    = "ITOps, SRE, Security, Backend teams"
    "Icinga"       = "ITOps, SRE, Security, Backend teams"
    "HackerOne"    = "Security team only"
    "ADP"          = "People Ops, Legal, ITOps teams"
    "CultureAmp"   = "People Ops, ITOps teams"
    "SurveyMonkey" = "Product team only"
  }
}

resource "azuread_application" "stub_apps" {
  for_each     = local.stub_apps
  display_name = "TinyCo-${each.key}"
}

resource "azuread_service_principal" "stub_apps" {
  for_each  = local.stub_apps
  client_id = azuread_application.stub_apps[each.key].client_id
}