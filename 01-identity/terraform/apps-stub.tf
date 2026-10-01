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
# - Assign appropriate groups per the team list in teams.csv
#   (the list below is a copy for reference; Terraform does not
#   read teams.csv)

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
  display_name = "${var.company_name}-${each.key}"
}

resource "azuread_service_principal" "stub_apps" {
  for_each  = local.stub_apps
  client_id = azuread_application.stub_apps[each.key].client_id

  # No groups are assigned to the stubs yet, so with this set nobody
  # can get a token for them until access is granted on purpose.
  # The provider default (false) would let any tenant user or guest in.
  app_role_assignment_required = true
}