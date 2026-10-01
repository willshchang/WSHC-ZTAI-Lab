#!/usr/bin/env bash
# ============================================================
# MICROSOFT ENTRA GALLERY APP LOOKUP
# ============================================================
# Run this before registering any new application in Entra.
# If the app exists in the gallery, use the gallery app instead
# of a custom registration: gallery apps come pre-configured
# with correct SSO protocols and permissions.
#
# Usage:   ./scripts/01-gallery-lookup.sh "AppName"
# Example: ./scripts/01-gallery-lookup.sh "Mattermost"
# Example: ./scripts/01-gallery-lookup.sh "Tableau"
#
# Requires: Azure CLI, signed in with `az login`.
#
# How it works:
# Calls Microsoft Graph GET /v1.0/applicationTemplates with a
# server-side filter, so only matching templates come back.
# The displayName property supports $filter with contains():
# https://learn.microsoft.com/en-us/graph/api/applicationtemplate-list
# https://learn.microsoft.com/en-us/graph/api/resources/applicationtemplate
#
# Safety: the app name only ever goes into the OData filter
# string, with single quotes doubled as OData requires, and az
# URL-encodes it. It is never placed inside the --query
# (JMESPath) expression, so a name cannot change the query.
# ============================================================

set -euo pipefail

if [ "$#" -ne 1 ] || [ -z "${1// /}" ]; then
  echo "Usage: $0 \"AppName\"" >&2
  echo "Example: $0 \"Mattermost\"" >&2
  exit 2
fi

command -v az >/dev/null 2>&1 || {
  echo "ERROR: Azure CLI (az) not found. Install it and run az login." >&2
  exit 1
}

APP_NAME=$1

# OData string literals escape a single quote by doubling it
ODATA_NAME=${APP_NAME//\'/\'\'}

echo "Searching Microsoft Entra Gallery for: $APP_NAME"
echo "----------------------------------------------------"

az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/applicationTemplates" \
  --url-parameters "\$filter=contains(displayName,'${ODATA_NAME}')" "\$select=id,displayName" \
  --query "value[].{Name:displayName, ID:id}" \
  --output table

echo "----------------------------------------------------"
echo "If found: register via Entra Gallery (recommended)"
echo "If not found: use custom azuread_application in Terraform"
echo "  with preferred_single_sign_on_mode = 'saml'"
