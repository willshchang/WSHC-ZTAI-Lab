# ============================================================
# TAILSCALE AUTH KEYS
# ============================================================
# Generates pre-authentication keys via Terraform — allowing
# devices to join the Tailnet without manual browser login.
#
# What this file does:
# - Generates a tagged auth key for the Azure VM
# - Outputs the key securely for use in VM setup scripts
#
# IaC boundary — what this enables:
# With this key, VM enrollment becomes fully scriptable:
#   curl -fsSL https://tailscale.com/install.sh | sh
#   sudo tailscale up --authkey=$(terraform output -raw vm_auth_key) \
#     --ssh --accept-routes
#
# Without this key, VM enrollment requires manual browser login
# — the primary friction point in Tailscale deployments at scale.
#
# Key design decisions:
# - reusable = false     → single-use, limits blast radius if leaked
# - ephemeral = false    → VM persists after going offline
# - preauthorized = true → VM joins without manual approval
# - expiry = 3600        → key expires in 1 hour — use immediately
# - tags                 → VM auto-tagged as tag:server on enrollment
#
# Security note — secret sprawl prevention:
# Auth key is marked sensitive = true and never printed in plain
# text. Access via: terraform output -raw vm_auth_key
# Store in a secrets manager (Azure Key Vault, HashiCorp Vault)
# in production — never in version control.
#
# Official reference:
# https://tailscale.com/kb/1085/auth-keys
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_key
# ============================================================

# ============================================================
# VARIABLES — Auth key configuration
# ============================================================
# Add these to variables.tf and terraform.tfvars:
#
# variable "auth_key_expiry" {
#   description = "Auth key expiry in seconds. Default 3600 (1 hour) — use immediately after apply"
#   type        = number
#   default     = 3600
# }
# ============================================================

# ============================================================
# VM AUTH KEY — Azure VM enrollment
# ============================================================
# Generates a single-use, pre-authorized auth key tagged with
# tag:server. Used to enroll tinyco-vm into the Tailnet via
# CLI without browser interaction.
#
# Usage after terraform apply:
#   On the Azure VM, run:
#   curl -fsSL https://tailscale.com/install.sh | sh
#   sudo tailscale up \
#     --authkey=$(terraform output -raw vm_auth_key) \
#     --ssh \
#     --accept-routes \
#     --advertise-exit-node
#
# Production expansion:
# Generate separate keys per device type or environment:
#   tailscale_tailnet_key.prod_server_key
#   tailscale_tailnet_key.staging_server_key
#   tailscale_tailnet_key.ci_ephemeral_key  (ephemeral = true)
# ============================================================
resource "tailscale_tailnet_key" "vm_auth_key" {
  # Single-use — expires after one device enrolls
  # Use reusable = true only for CI/CD pipelines spinning
  # up multiple identical nodes
  reusable = false

  # false = device persists after going offline
  # true  = device auto-removed when offline (use for CI/CD)
  ephemeral = false

  # Skips manual device approval in admin console
  # Requires device approval to be enabled in tailnet settings
  preauthorized = true

  # Key expires in 1 hour — use immediately after terraform apply
  # Range: 60 to 7776000 seconds (90 days maximum)
  expiry = 3600

  description = "Terraform auth key for tinyco-vm"

  # Auto-tags device as tag:server on enrollment
  # Must match tagOwners defined in acl.tf
  tags = [var.tag_server]

  depends_on = [tailscale_acl.policy]
}

# ============================================================
# OUTPUT — Secure key retrieval
# ============================================================
# Auth key is marked sensitive — never printed in plain text
# during terraform apply or plan output.
#
# Retrieve after apply:
#   terraform output -raw vm_auth_key
#
# Production pattern — pipe directly to VM setup:
#   KEY=$(terraform output -raw vm_auth_key)
#   ssh admin@vm "sudo tailscale up --authkey=$KEY --ssh"
#
# Never store the key in:
# - Version control
# - Plain text files
# - Shell history (use process substitution where possible)
#
# IMPORTANT — Tag ownership chain for OAuth clients:
# OAuth client → assigned tag:terraform (manager tag)
# tag:terraform → owns tag:server in ACLs
# This chain allows OAuth client to generate auth keys
# tagged as tag:server without direct tag ownership.
# Reference: https://tailscale.com/docs/features/oauth-clients
# ============================================================
output "vm_auth_key" {
  value       = tailscale_tailnet_key.vm_auth_key.key
  sensitive   = true
  description = "Tailscale auth key for tinyco-vm enrollment — expires in 1 hour. Retrieve with: terraform output -raw vm_auth_key"
}