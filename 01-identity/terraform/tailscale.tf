# ============================================================
# TAILSCALE: MULTI-TENANT GALLERY APP
# ============================================================
# NOTE: As a Gallery App, Tailscale's master identity lives in 
# their tenant. We use 'data' to find the template and 'resource' 
# with 'use_existing' to manage the local Enterprise Application 
# once manual Admin Consent is granted.
# ============================================================

# ============================================================
# 1. DISCOVERY: Find Tailscale in the Microsoft Gallery
# ============================================================
# This data source searches the global Microsoft App Gallery 
# for the official Tailscale template. It ensures we use the 
# correct Application ID provided by Tailscale Inc.
data "azuread_service_principal" "tailscale" {
  display_name = "Tailscale"
}