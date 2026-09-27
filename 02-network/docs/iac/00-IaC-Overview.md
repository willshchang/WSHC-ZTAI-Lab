# Tailscale IaC — Overview

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/kb/1210/terraform-provider

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
(Google or Microsoft) for SSO integration.

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
cd Tailscale/terraform

terraform init      # download Tailscale provider
terraform fmt       # fix formatting
terraform validate  # check syntax
terraform plan      # review changes
terraform apply     # deploy
```

**Retrieve VM auth key after apply:**
```bash
terraform output -raw vm_auth_key
```

Use this key to enroll the VM:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up \
  --authkey=$(terraform output -raw vm_auth_key) \
  --ssh \
  --accept-routes \
  --advertise-exit-node
```

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