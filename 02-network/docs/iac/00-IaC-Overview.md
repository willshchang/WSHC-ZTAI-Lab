# Tailscale IaC — Overview

**Document Type:** IaC Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** IT Administrator  
**Last Updated:** September 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## Overview

This folder documents the Tailscale Terraform IaC implementation — 
one document per Terraform file, following the principle of one 
payload per policy for clean auditability and maintenance.

For the full network architecture and Zero Trust design, see:  
[03-Network_Architecture.md](../03-Network_Architecture.md)

---

## What Terraform Manages vs Manual Steps

Terraform uses the Tailscale API to manage Tailnet configuration — 
not device installation or enrollment. This is the IaC boundary.

| Step | Tool | Method |
|---|---|---|
| Create Tailscale account | Manual | tailscale.com |
| Install Tailscale on VM | Manual | `curl -fsSL https://tailscale.com/install.sh \| sh` |
| Install Tailscale on Windows/Mac | Manual | tailscale.com/download |
| Install Tailscale on Apple TV/iPhone/iPad | Manual | App Store |
| Enroll devices into Tailnet | Manual | `tailscale up` or app sign-in |
| Enable subnet router on Apple TV | Manual | Tailscale app → Settings |
| Enable Tailscale SSH on VM | Manual | `sudo tailscale set --ssh` |
| Accept routes on Linux | Manual | `sudo tailscale set --accept-routes` |
| **ACL policy** | **Terraform** | `acl.tf` |
| **Device tags** | **Terraform** | `tags.tf` |
| **MagicDNS** | **Terraform** | `dns.tf` |
| **HTTPS certificates** | **Terraform** | `tailnet_settings.tf` |
| **Subnet route approvals** | **Terraform** | `subnet-routes.tf` |
| **Auth key generation** | **Terraform** | `keys.tf` |

---

## Code Is the Source of Truth

Once Terraform manages a setting, the code decides what that
setting should be, not the admin console.

**The rule:** change the code or `terraform.tfvars`, then run
`terraform plan` and `terraform apply`. Do not change
Terraform-managed settings by clicking in the admin console.

**Why it matters:** anything changed by hand in the console
is **drift**, a gap between what the code says and what is
actually running. `terraform plan` detects it, and
`terraform apply` puts it back to match the code. A manual
fix that is never written into code gets silently undone on
the next apply.

**Verified in this lab:**

| What happened | What Terraform did |
|---|---|
| A subnet route was turned off in the console during an HA failover test and never turned back on | `terraform plan` flagged it; `apply` restored the route |
| Both Apple TVs were approved as exit nodes by hand in the console | `terraform plan` wanted to remove them. Fixed by adding the `exit_node_enabled` switch so the code matches the intended state |

**Healthy state check:**
```bash
cd 02-network/terraform
terraform plan
# Expected: No changes. Your infrastructure matches the configuration.
```

Any other result means something changed outside the code.
Read the plan before applying: either the change was
unintended (apply to revert it) or it was intended (write it
into the code first, then apply).

> **Manual steps are different:** installing Tailscale,
> enrolling devices, advertising routes and choosing an exit
> node on a client are device-side actions outside the IaC
> boundary (see the table above). Terraform does not track
> them, so they never show up as drift.

---

## Tools Matrix — Full Stack

| Layer | Tool | Purpose |
|---|---|---|
| **Tailnet config** | Terraform | ACL, tags, DNS, subnet approval, auth keys |
| **Device setup** | CLI | Install, enroll, enable SSH, accept routes |
| **Visual management** | Admin console | Verify state, monitor, approve devices |

---

## Prerequisites

Before running `terraform apply`:

**1. Create Tailscale account**  
Sign up at tailscale.com — sign in with your identity provider 
(Google or Microsoft) for SSO integration. The lab tailnet uses the 
admin's personal identity provider today; moving it to Entra ID 
(Microsoft) is a planned step.

**2. Install and enroll all devices**  
Each device must be enrolled in the Tailnet before Terraform 
can manage its tags or routes.

Verify all devices are enrolled:
```bash
tailscale status
```

**3. Enable subnet router on Apple TVs**  
Tailscale app → Settings → Enable Subnet Router  
Both Apple TVs must be advertising `192.168.1.0/24` before 
running `terraform apply`.

**4. Enable Tailscale SSH on VM**
```bash
sudo tailscale set --ssh
```

**5. Create OAuth client**  
Go to `tailscale.com/admin/settings/oauth` → Generate credential.

Required scopes — all Write:
- Devices → Core
- Devices → Tags: `tag:server`, `tag:subnet-router`, `tag:terraform`
- Devices → Routes
- General → Policy File
- General → DNS
- Keys → Auth Keys: `tag:server`
- Settings → Networking Settings

**6. Configure terraform.tfvars**
```bash
cp terraform.tfvars.example terraform.tfvars
# Fill in OAuth credentials and device DNS names
```

---

## Deployment

```bash
cd 02-network/terraform

terraform init      # download Tailscale provider
terraform fmt       # fix formatting
terraform validate  # check syntax
terraform plan      # review changes
terraform apply     # deploy
```

**Retrieve the VM auth key after apply** (on the admin machine, in 
`02-network/terraform`, not on the VM):
```bash
terraform output -raw vm_auth_key
```

Enroll the VM from a console that does not need port 22 (for 
example Azure Serial Console), passing the key from a root-only 
file so it never appears on a command line:
```bash
sudo install -m 600 /dev/null /root/ts-authkey
sudo nano /root/ts-authkey          # paste the key, save
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=file:/root/ts-authkey --ssh
sudo shred -u /root/ts-authkey
```

Full steps and the single-use key behavior: [08-keys.md](./08-keys.md).

---

## File Reference

| File | Purpose |
|---|---|
| `providers.tf` | Tailscale provider config, OAuth authentication |
| `variables.tf` | All variable definitions — zero hardcoded values |
| `acl.tf` | ACL grants, SSH rules, tag ownership |
| `tags.tf` | Device tag assignments via data sources |
| `dns.tf` | MagicDNS configuration |
| `tailnet_settings.tf` | HTTPS certs, device auto-updates |
| `subnet-routes.tf` | Subnet route approvals for HA pair |
| `keys.tf` | Auth key generation for device enrollment |
| `terraform.tfvars` | Real values — gitignored, never committed |
| `terraform.tfvars.example` | Template — committed, no real values |

---

## Official References

| Topic | URL |
|---|---|
| Tailscale Terraform provider | https://tailscale.com/kb/1210/terraform-provider |
| Provider registry | https://registry.terraform.io/providers/tailscale/tailscale/latest |
| OAuth clients | https://tailscale.com/docs/features/oauth-clients |
| IaC overview | https://tailscale.com/kb/1370/infrastructure-as-code |