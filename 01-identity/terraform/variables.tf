# variables.tf
# This file defines all the input variables Terraform needs to connect to Azure.
# Think of it as the "settings panel" — no resources are created here.
# The actual values are stored in terraform.tfvars (which never goes to GitHub).

variable "tenant_id" {
  description = "The unique ID of your Azure/Entra tenant (TinyCoDDG)"
  type        = string
}

variable "subscription_id" {
  description = "The Azure subscription ID where resources will be created"
  type        = string
}

variable "admin_password" {
  description = "Default password assigned to all TinyCo user accounts"
  type        = string
  sensitive   = true
}

# ============================================================
# ORGANIZATION SETTINGS
# ============================================================
# These variables act as the "Master Switch" for the company identity.
# By referencing these variables in other files, our Terraform code 
# remains 100% generic and portable. If TinyCo changes its name tomorrow, 
# we only update the tfvars file, not the underlying logic.

variable "company_name" {
  description = "The official name of the organization (e.g., TinyCo)"
  type        = string
}

variable "domain_name" {
  description = "The primary Entra ID domain (e.g., TinyCoDDG.onmicrosoft.com)"
  type        = string
}

# ============================================================
# ROLE MAPPING BUCKETS (ZERO-HARDCODE ARCHITECTURE)
# ============================================================
# These variables define the structure for our RBAC system. 
# They act as empty containers. The actual team names (e.g., "ITOps") 
# and their Role IDs are injected securely at runtime via terraform.tfvars.

variable "entra_role_map" {
  description = "A map linking Team Names to Entra ID Role GUIDs"
  type        = map(string)
  default     = {}
}

variable "azure_role_map" {
  description = "A map linking Team Names to Azure Resource Role GUIDs"
  type        = map(string)
  default     = {}
}

# ============================================================
# EXISTING ADMIN REFERENCE
# ============================================================
# This tells Terraform to expect the email address of the 
# existing admin, but doesn't reveal what it is

variable "primary_admin_upn" {
  description = "The User Principal Name (email) of the existing Global Admin account"
  type        = string
}

# ============================================================
# BREAK GLASS ADMIN REFERENCE
# ============================================================
# This tells Terraform to expect the email address of 
# the existing admin, but doesn't reveal what it is.

variable "grader_account_prefix" {
  description = "The username prefix for the emergency/grader account (e.g., admin.test)"
  type        = string
}

# ============================================================
# APP RETURN URL BUCKET (SAML HANDSHAKE LAYER)
# ============================================================
# This map stores the base URLs or FQDNs for our internal apps.
# By centralizing these, we can dynamically build the Redirect
# and Identifier URIs across the environment.

variable "app_urls" {
  description = "A map linking App Keys to their primary FQDNs (e.g., Tailscale addresses)"
  type        = map(string)
  default = {
    "mattermost" = "tinyco-vm.tail7ee901.ts.net"
    "tableau"    = "55fb207b-97b5-4e4a-b3ba-52aabbce0a63/25fa8ac1-2ce8-4476-bd67-572dfba144ae"
    "elastic"    = "tinyco-prod-cluster-3acb9f.kb.westus2.azure.elastic-cloud.com"
  }
}