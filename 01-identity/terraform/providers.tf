# providers.tf
# This file tells Terraform which cloud platforms we're working with.
# A "provider" is like a plugin — it gives Terraform the ability to talk
# to a specific platform. We need two providers:
# - "azurerm" to manage Azure resources (the VM, subscription etc.)
# - "azuread" to manage Entra ID (users, groups, roles, apps)
#
# DEPLOYMENT HISTORY
# This layer was deployed and validated on the tenant
# TinyCoDDG.onmicrosoft.com during the Microsoft 365 E5 trial
# (late spring 2026). The trial has since ended. No tenant
# values are hardcoded here, so the same code deploys to any
# tenant by changing terraform.tfvars.

terraform {
  required_providers {
    azuread = {
      source  = "hashicorp/azuread"
      version = "~> 2.47"
    }
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.85"
    }
  }
}

provider "azuread" {
  tenant_id = var.tenant_id
}

provider "azurerm" {
  features {}
  subscription_id = var.subscription_id
  tenant_id       = var.tenant_id
}