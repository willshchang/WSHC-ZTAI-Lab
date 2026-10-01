# ============================================================
# TAILSCALE AUTH KEYS
# ============================================================
# Generates pre-authentication keys via Terraform, allowing
# devices to join the Tailnet without manual browser login.
#
# What this file does:
# - Generates a tagged auth key for the Azure VM
# - Outputs the key (sensitive) for the VM enrollment step
#
# Without this key, VM enrollment requires manual browser login,
# the primary friction point in Tailscale deployments at scale.
#
# Key design decisions:
# - reusable = false     -> single-use, limits blast radius if leaked
# - ephemeral = false    -> VM persists after going offline
# - preauthorized = true -> only matters if device approval is
#                           turned on (devices_approval_on in
#                           tailnet_settings.tf, currently off).
#                           Then a device enrolled with this key
#                           skips the manual approval step.
# - expiry = 3600        -> key expires in 1 hour, use immediately
# - tags                 -> VM auto-tagged as tag:server on enrollment
#
# Single-use behavior after first use:
# Once a device enrolls (or the hour passes), the key is invalid.
# Terraform keeps it in state and does NOT create a new one
# (provider docs, recreate_if_invalid: "By default, reusable keys
# will be recreated, but single-use keys will not.").
# To enroll again, mint a fresh key:
#   terraform apply -replace=tailscale_tailnet_key.vm_auth_key
#
# Security note (secret sprawl prevention):
# The output is sensitive and never printed by plan or apply.
# Never put the key on a command line (it lands in shell history
# and the process list) and never commit it. Store it in a
# secrets manager (Azure Key Vault, HashiCorp Vault) in production.
#
# Official reference:
# https://tailscale.com/kb/1085/auth-keys
# https://github.com/tailscale/terraform-provider-tailscale/blob/v0.28.0/docs/resources/tailnet_key.md
# ============================================================

# ============================================================
# VM AUTH KEY: Azure VM enrollment
# ============================================================
# Generates a single-use, tagged auth key. Used to enroll
# tinyco-vm into the Tailnet via CLI without browser interaction.
#
# Usage after terraform apply:
#
# 1. On the ADMIN machine (where you run Terraform, in
#    02-network/terraform), read the key:
#      terraform output -raw vm_auth_key
#
# 2. Open a console on the VM that does not need port 22, for
#    example Azure Serial Console. Port 22 is closed at the NSG,
#    so plain ssh to the VM is not an option, and Tailscale SSH
#    only works after the VM has joined.
#
# 3. On the VM, put the key in a root-only file and pass the
#    file to tailscale up. The "file:" prefix makes the CLI read
#    the key from the file, so it never appears on a command line:
#      sudo install -m 600 /dev/null /root/ts-authkey
#      sudo nano /root/ts-authkey      # paste the key, save
#      curl -fsSL https://tailscale.com/install.sh | sh
#      sudo tailscale up --auth-key=file:/root/ts-authkey --ssh
#      sudo shred -u /root/ts-authkey
#    Reference: https://tailscale.com/kb/1241/tailscale-up
#    (--auth-key: "if it begins with file:, then it's a path to
#    a file containing the authkey")
#
# The VM is not an exit node and does not need --accept-routes:
# the ACL gives tag:server no access to the home subnet.
#
# Production expansion:
# Generate separate keys per device type or environment:
#   tailscale_tailnet_key.prod_server_key
#   tailscale_tailnet_key.staging_server_key
#   tailscale_tailnet_key.ci_ephemeral_key  (ephemeral = true)
# ============================================================
resource "tailscale_tailnet_key" "vm_auth_key" {
  # Single-use: invalid after one device enrolls
  # Use reusable = true only for CI/CD pipelines spinning
  # up multiple identical nodes
  reusable = false

  # false = device persists after going offline
  # true  = device auto-removed when offline (use for CI/CD)
  ephemeral = false

  # Pre-approves the device IF device approval is enabled in
  # tailnet settings. With device approval off (current state),
  # this has no effect.
  preauthorized = true

  # Key expires in 1 hour, use immediately after terraform apply
  # Range: 60 to 7776000 seconds (90 days maximum)
  expiry = 3600

  description = "Terraform auth key for tinyco-vm"

  # Auto-tags device as tag:server on enrollment
  # Must match tagOwners defined in acl.tf
  tags = [var.tag_server]

  depends_on = [tailscale_acl.policy]
}

# ============================================================
# OUTPUT: Secure key retrieval
# ============================================================
# Auth key is marked sensitive, never printed in plain text
# during terraform apply or plan output.
#
# Retrieve after apply, on the admin machine:
#   terraform output -raw vm_auth_key
#
# Then follow the file-based enrollment steps above.
#
# Never store the key in:
# - Version control
# - Long-lived plain text files (delete the VM copy after use)
# - Shell history or command-line arguments
#
# IMPORTANT: Tag ownership chain for OAuth clients:
# OAuth client -> assigned tag:terraform (manager tag)
# tag:terraform -> owns tag:server in ACLs
# This chain allows OAuth client to generate auth keys
# tagged as tag:server without direct tag ownership.
# Reference: https://tailscale.com/docs/features/oauth-clients
# ============================================================
output "vm_auth_key" {
  value       = tailscale_tailnet_key.vm_auth_key.key
  sensitive   = true
  description = "Single-use Tailscale auth key for tinyco-vm enrollment, valid for 1 hour. Retrieve with: terraform output -raw vm_auth_key"
}
