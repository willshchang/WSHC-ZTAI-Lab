cat > ~/Desktop/WSHC-Entra-IaC-Zero-Trust-Lab/scripts/01-gallery-lookup.sh << 'EOF'
#!/bin/bash
# ============================================================
# MICROSOFT ENTRA GALLERY APP LOOKUP
# ============================================================
# Run this before registering any new application in Entra.
# If the app exists in the gallery, use the gallery app instead
# of a custom registration — gallery apps come pre-configured
# with correct SSO protocols and permissions.
#
# Usage: ./scripts/01-gallery-lookup.sh "AppName"
# Example: ./scripts/01-gallery-lookup.sh "Mattermost"
# Example: ./scripts/01-gallery-lookup.sh "Tableau"
# ============================================================

APP_NAME="$1"

if [ -z "$APP_NAME" ]; then
  echo "Usage: ./scripts/01-gallery-lookup.sh \"AppName\""
  echo "Example: ./scripts/01-gallery-lookup.sh \"Mattermost\""
  exit 1
fi

echo "Searching Microsoft Entra Gallery for: $APP_NAME"
echo "----------------------------------------------------"

az rest --method GET \
  --url "https://graph.microsoft.com/v1.0/applicationTemplates" \
  --query "value[?contains(displayName, '$APP_NAME')].{Name:displayName, ID:id}" \
  --output table

echo "----------------------------------------------------"
echo "If found: register via Entra Gallery (recommended)"
echo "If not found: use custom azuread_application in Terraform"
echo "  with preferred_single_sign_on_mode = 'saml'"
EOF

chmod +x ~/Desktop/WSHC-Entra-IaC-Zero-Trust-Lab/scripts/01-gallery-lookup.sh