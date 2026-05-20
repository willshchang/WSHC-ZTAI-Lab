# ============================================================
# TAILSCALE ACL POLICY
# ============================================================
# Manages the complete Tailnet access control policy via
# Terraform. This is the core Zero Trust enforcement layer —
# defining who can reach what, over which ports, and who
# can SSH into which devices.
#
# Design principle:
# Identity drives access, tags define infrastructure roles.
# ACL rules mirror the Entra ID RBAC model — one source of
# truth for roles, two enforcement layers (identity + network).
#
# Policy structure:
# 1. Tag ownership — who can assign tags to devices
# 2. Grants — network access rules (least privilege)
# 3. SSH rules — identity-driven SSH access
# 4. Tests — validates policy on every save
#
# Official reference:
# https://tailscale.com/docs/reference/syntax/policy-file
# https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/acl
# ============================================================

# ============================================================
# IMPORT EXISTING ACL POLICY
# ============================================================
# If a policy file already exists in the Tailnet, Terraform
# must import it before managing it. This import block handles
# that automatically on first terraform apply.
#
# Without this, Terraform errors with "precondition failed,
# invalid old hash" when trying to overwrite an existing policy.
#
# This block is safe to leave in permanently — on subsequent
# applies Terraform skips it if the resource is already in state.
# ============================================================
import {
  to = tailscale_acl.policy
  id = "acl"
}

resource "tailscale_acl" "policy" {
  acl = jsonencode({

    # ==========================================================
    # TAG OWNERSHIP
    # ==========================================================
    # Defines who is permitted to assign each tag to devices.
    # Without tagOwners, tags cannot be referenced in grants.
    #
    # Tags represent infrastructure function, not user identity:
    # - tag:server        → cloud infrastructure (Azure VM)
    # - tag:subnet-router → network infrastructure (Apple TVs)
    # - tag:terraform → manager tag for Terraform OAuth client
    #                   owns tag:server and tag:subnet-router
    #                   enabling auth key generation via IaC
    #
    # User devices carry no tags — identified by Tailscale
    # identity (email) which maps back to the IdP via SSO.
    #
    # Production expansion:
    # Add additional tags as infrastructure grows:
    # "tag:database", "tag:monitoring", "tag:build-server"
    # ==========================================================
    tagOwners = {
      "tag:terraform"         = [var.admin_email]
      (var.tag_server)        = ["tag:terraform"]
      (var.tag_subnet_router) = ["tag:terraform"]
    }

    # ==========================================================
    # GRANTS — Network Access Rules
    # ==========================================================
    # Explicit least-privilege grants. Tailscale is default
    # deny — anything not listed here is automatically blocked.
    # No deny rules needed.
    #
    # Current model (personal lab — single identity):
    # admin_email = ITOps Engineer with full access
    #
    # Production expansion — multi-user model:
    # Replace admin_email grants with group-based grants:
    # "group:itops"    → full access
    # "group:sre"      → servers only, tcp:22 + tcp:443
    # "group:finance"  → payroll server only, tcp:8443
    # See: tailscale.com/kb/1337/acl-syntax#groups
    # ==========================================================
    grants = [
      # --------------------------------------------------------
      # ITOps Engineer → Cloud infrastructure
      # Full access to Azure VM for administration and SSH
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.tag_server]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer → Network infrastructure
      # Full access to Apple TV subnet routers for management
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.tag_subnet_router]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer → Home LAN via subnet router
      # Reaches non-Tailscale devices (modem, AP, printers)
      # through the Apple TV subnet router
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.home_subnet_cidr]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # Cloud server → Home LAN
      # Azure VM can initiate connections to home subnet
      # Use case: server-side monitoring, backup traffic
      #
      # Production note: restrict ip to specific ports
      # once use case is defined e.g. ["tcp:9090"]
      # --------------------------------------------------------
      {
        src = [var.tag_server]
        dst = [var.home_subnet_cidr]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer → Internet via exit node
      # Allows all personal devices authenticated as admin_email
      # to route traffic through an approved exit node.
      #
      # Why this grant is required:
      # Tailscale is default deny — even approved exit nodes are
      # invisible in the client dropdown without an explicit
      # autogroup:internet grant. This is the unlock.
      #
      # autogroup:internet is a Tailscale built-in autogroup
      # representing all internet-bound traffic routed via
      # an exit node. No variable needed.
      #
      # Production expansion:
      # Scope src to specific tags or groups if exit node
      # access should be restricted to certain devices only:
      # src = ["tag:mobile"] or src = ["group:contractors"]
      #
      # Official reference:
      # https://tailscale.com/kb/1103/exit-nodes#allow-exit-nodes-using-acls
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = ["autogroup:internet"]
        ip  = ["*"]
      }
      # --------------------------------------------------------
      # IMPLICIT DENIES — not written, Tailscale default:
      # tag:server        → user devices     = BLOCKED
      # tag:subnet-router → anywhere         = BLOCKED
      # Any unlisted src/dst combination     = BLOCKED
      # --------------------------------------------------------
    ]

    # ==========================================================
    # SSH ACCESS RULES
    # ==========================================================
    # Identity-driven SSH — replaces password authentication.
    # Tailscale intercepts SSH before it reaches the OS,
    # authenticates via Tailscale identity, then connects
    # to the specified Linux user on the destination.
    #
    # Prerequisites (IaC boundary — manual steps required):
    # 1. Enable Tailscale SSH on VM:
    #    sudo tailscale set --ssh
    # 2. Linux user must exist on destination VM:
    #    sudo adduser <username>
    #    sudo usermod -aG sudo <username>
    #
    # Production expansion:
    # Use autogroup:nonroot with IdP-provisioned Linux users:
    # "users": ["autogroup:nonroot"]
    # This maps Tailscale identity to matching Linux username
    # automatically — no hardcoded usernames needed.
    # See: tailscale.com/kb/1337/acl-syntax#autgroups
    # ==========================================================
    ssh = [
      {
        action = "accept"
        src    = [var.admin_email]
        dst    = [var.tag_server]
        users  = ["tinyco-admin", "iwill", "root"]
      }
    ]

    # ==========================================================
    # ACL TESTS
    # ==========================================================
    # Validates policy rules every time terraform apply runs.
    # If a test fails, the apply is rejected — prevents
    # accidentally locking yourself out of the Tailnet.
    #
    # Format: hostname:port
    # ==========================================================
    tests = [
      {
        src = var.admin_email
        accept = [
          "${var.tag_server}:22",
          "${var.tag_subnet_router}:80",
          "192.168.1.1:80",
          #"autogroup:internet:443"
        ]
        deny = []
      }
    ]
  })
}