# ============================================================
# TAILSCALE ACL POLICY
# ============================================================
# Manages the complete Tailnet access control policy via
# Terraform. This is the core Zero Trust enforcement layer:
# who can reach what, over which ports, and who can SSH into
# which devices.
#
# Design principle:
# Identity drives access, tags define infrastructure roles.
#
# Current state (honest scope):
# The only human principal is var.admin_email, the admin's own
# Tailscale login. The tailnet does not use Entra ID as its
# identity provider yet, so Entra Conditional Access and MFA do
# not gate tailnet sign-in. Moving the tailnet to Entra ID and
# using SCIM-synced Entra groups in this policy is a planned step.
#
# Policy structure:
# 1. Tag ownership: who can assign tags to devices
# 2. Grants: network access rules (least privilege)
# 3. SSH rules: identity-driven SSH access
# 4. Tests and sshTests: validated on every save
#
# Official reference:
# https://tailscale.com/docs/reference/syntax/policy-file
# https://github.com/tailscale/terraform-provider-tailscale/blob/v0.28.0/docs/resources/acl.md
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
# This block is safe to leave in permanently: on subsequent
# applies Terraform skips it if the resource is already in state.
# ============================================================
import {
  to = tailscale_acl.policy
  id = "acl"
}

locals {
  # One address on the home LAN used by the policy tests below.
  # Host 1 is the gateway in this lab (the ISP modem). Derived
  # from the variable so the tests follow any subnet change.
  home_test_ip = cidrhost(var.home_subnet_cidr, 1)
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
    # - tag:server        -> cloud infrastructure (Azure VM)
    # - tag:subnet-router -> network infrastructure (Apple TVs)
    # - tag:terraform     -> manager tag for the Terraform OAuth
    #                        client; owns tag:server and
    #                        tag:subnet-router so auth keys can
    #                        be generated via IaC
    #
    # User devices carry no tags. They are identified by the
    # Tailscale login of their owner (var.admin_email).
    #
    # Production expansion:
    # Add additional tags as infrastructure grows:
    # "tag:database", "tag:monitoring", "tag:build-server"
    # ==========================================================
    tagOwners = {
      (var.tag_terraform)     = [var.admin_email]
      (var.tag_server)        = [var.tag_terraform]
      (var.tag_subnet_router) = [var.tag_terraform]
    }

    # ==========================================================
    # GRANTS: Network Access Rules
    # ==========================================================
    # Explicit least-privilege grants. Tailscale is default
    # deny: anything not listed here is automatically blocked.
    # No deny rules needed.
    #
    # Current model (personal lab, single identity):
    # admin_email = ITOps Engineer with full access
    #
    # Production expansion (multi-user model):
    # Replace admin_email grants with group-based grants:
    # "group:itops"    -> full access
    # "group:sre"      -> servers only, tcp:22 + tcp:443
    # "group:finance"  -> payroll server only, tcp:8443
    # See: https://tailscale.com/docs/reference/syntax/policy-file#groups
    # ==========================================================
    grants = [
      # --------------------------------------------------------
      # ITOps Engineer -> Cloud infrastructure
      # Full access to Azure VM for administration and SSH
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.tag_server]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer -> Network infrastructure
      # Full access to Apple TV subnet routers for management
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.tag_subnet_router]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer -> Home LAN via subnet router
      # Reaches non-Tailscale devices (modem, AP, printers)
      # through the Apple TV subnet router
      # --------------------------------------------------------
      {
        src = [var.admin_email]
        dst = [var.home_subnet_cidr]
        ip  = ["*"]
      },
      # --------------------------------------------------------
      # ITOps Engineer -> Internet via exit node
      # Allows all personal devices authenticated as admin_email
      # to route traffic through an approved exit node.
      #
      # Why this grant is required:
      # Tailscale is default deny: even approved exit nodes are
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
      # REMOVED: tag:server -> home subnet (all ports)
      # The Azure VM is internet-facing. That grant let it open
      # any port on every home LAN device, with no use case
      # behind it. If a real need appears (for example
      # monitoring), add a narrow grant such as ip = ["tcp:9100"]
      # to one host, and update the deny tests below.
      #
      # IMPLICIT DENIES (not written, Tailscale default),
      # proven by the deny tests below:
      # tag:server        -> home subnet      = BLOCKED
      # tag:server        -> tag:subnet-router = BLOCKED
      # tag:subnet-router -> tag:server       = BLOCKED
      # Any unlisted src/dst combination      = BLOCKED
      # --------------------------------------------------------
    ]

    # ==========================================================
    # SSH ACCESS RULES
    # ==========================================================
    # Identity-driven SSH that replaces password authentication.
    # Tailscale intercepts SSH before it reaches the OS,
    # authenticates via Tailscale identity, then connects
    # to the specified Linux user on the destination.
    #
    # Two rules:
    # 1. accept: everyday non-root users (var.ssh_users).
    #    var.ssh_users is validated to never contain "root".
    # 2. check:  root only. Tailscale asks the admin to sign in
    #    again in the browser if the last check is older than
    #    var.ssh_root_check_period. Check rules are evaluated
    #    before accept rules.
    #
    # Prerequisites (IaC boundary, manual steps required):
    # 1. Enable Tailscale SSH on VM:
    #    sudo tailscale set --ssh
    # 2. Linux user must exist on destination VM:
    #    sudo adduser <username>
    #    sudo usermod -aG sudo <username>
    #
    # Production expansion:
    # Use autogroup:nonroot with IdP-provisioned Linux users:
    # "users": ["autogroup:nonroot"]
    #
    # Official reference:
    # https://tailscale.com/docs/reference/syntax/policy-file#ssh
    # ==========================================================
    ssh = [
      {
        action = "accept"
        src    = [var.admin_email]
        dst    = [var.tag_server]
        users  = var.ssh_users
      },
      {
        action      = "check"
        src         = [var.admin_email]
        dst         = [var.tag_server]
        users       = ["root"]
        checkPeriod = var.ssh_root_check_period
      }
    ]

    # ==========================================================
    # ACL TESTS
    # ==========================================================
    # Validated every time the policy is saved (including by
    # terraform apply). If a test fails, the save is rejected.
    #
    # accept tests: the admin is never locked out.
    # deny tests:   the implicit denies stay denied. A future
    #               grant that opens one of these paths fails
    #               the apply until the test is changed on
    #               purpose.
    #
    # Format: host:port (a tag, IP or hostname, plus a port).
    # An autogroup:internet destination is not documented as a
    # valid test target, so exit node access is not tested here.
    # ==========================================================
    tests = [
      {
        src = var.admin_email
        accept = [
          "${var.tag_server}:22",
          "${var.tag_subnet_router}:80",
          "${local.home_test_ip}:80",
        ]
        deny = []
      },
      {
        # Internet-facing VM must not reach the home LAN or the
        # subnet routers.
        src    = var.tag_server
        accept = []
        deny = [
          "${local.home_test_ip}:80",
          "${local.home_test_ip}:22",
          "${var.tag_subnet_router}:22",
        ]
      },
      {
        # Subnet routers must not reach the VM.
        src    = var.tag_subnet_router
        accept = []
        deny = [
          "${var.tag_server}:22",
        ]
      }
    ]

    # ==========================================================
    # SSH TESTS
    # ==========================================================
    # accept: users the admin reaches without re-authentication
    # check:  users that require a recent browser check (root)
    # ==========================================================
    sshTests = [
      {
        src    = var.admin_email
        dst    = [var.tag_server]
        accept = var.ssh_users
        check  = ["root"]
      }
    ]
  })
}
