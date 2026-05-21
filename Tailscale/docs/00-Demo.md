# Tailscale IaC — Demo Reference

**Document Type:** Presentation Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** May 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/kb/1210/terraform-provider

---

## Demo Environment

| Device | Role | Status |
|---|---|---|
| Azure VM (`tinyco-vm`) | Cloud server, Tailscale SSH target | Start before demo, stop after |
| Living Room Apple TV (`iwilltvliving`) | Primary subnet router | Always on, ethernet |
| Bedroom Apple TV (`iwilltvmaster`) | HA subnet router | Always on, WiFi |
| Windows PC (`iwillwindows`) | ITOps engineer device, exit node | Personal device |
| iPhone (`iwill14pro`) | Personal device | Personal device |

**Before demo — start VM:**
Azure Portal → Virtual Machines → `tinyco-vm` → Start  
Wait ~2 minutes → confirm in Tailscale admin console → status shows online.

**After demo — stop VM:**
Azure Portal → Stop (not OS shutdown — must show "Stopped (deallocated)").

---

## Demo Flow

### 1. Show the Tailnet

```bash
tailscale status
```

Walk through what's connected — server, subnet routers, personal devices.
All authenticated via identity, no passwords, no VPN client config.

---

### 2. Tailscale SSH — Identity-Driven Access

```bash
tailscale ssh tinyco-admin@tinyco-vm
```

No key file. No password. Browser auth via Tailscale identity.  
Port 22 is closed via Azure NSG — this connection only exists inside the Tailnet.

**Talking point:**
> *"Traditional SSH = managing key files across every machine.
> Tailscale SSH = identity drives access. The same identity that
> controls network access controls SSH access. One policy, two layers."*

---

### 3. Subnet Routing — Reaching Non-Tailscale Devices

From the VM, ping the home network modem (non-Tailscale device):

```bash
ping -c 4 192.168.1.254
```

Traffic routes through the Apple TV subnet router — the modem has
no Tailscale installed. Zero config on the modem side.

**Talking point:**
> *"This is how Tailscale reaches legacy infrastructure — printers,
> on-prem servers, HRIS data centres — without installing anything
> on those devices. The subnet router is the bridge."*

---

### 4. HA Failover — Live Test

Start continuous ping:
```bash
ping 192.168.1.254
```

Admin console → Machines → `iwilltvliving` → Edit route settings →
uncheck `192.168.1.0/24` → Save.

Watch ping — no dropped packets. Tailscale fails over to
`iwilltvmaster` automatically. Re-enable `iwilltvliving` to restore.

**Talking point:**
> *"I disabled the primary subnet router mid-ping — zero dropped packets.
> Tailscale's control plane detects the change and reroutes instantly.
> No client reconfiguration. No failover script. It just works."*

---

### 5. Live ACL Policy Change — IaC Enforcement Demo

**Enterprise framing:**
> *"Say an engineer's VM should no longer reach the legacy HRIS
> data centre. One block commented out, one apply — access revoked
> instantly. No ticket, no firewall change, no waiting."*

**Step 1 — Prove access works:**
```bash
ping -c 4 192.168.1.254
```

**Step 2 — Comment out the `tag:server → home_subnet_cidr` grant in `acl.tf`:**
```hcl
# {
#   src = [var.tag_server]
#   dst = [var.home_subnet_cidr]
#   ip  = ["*"]
# },
```

**Step 3 — Apply:**
```bash
terraform apply -auto-approve
```

**Step 4 — Prove access is blocked:**
```bash
ping -c 4 192.168.1.254
```
Times out — VM can no longer reach home subnet. ✅

**Step 5 — Restore:**
Uncomment the block → `terraform apply -auto-approve` → ping works again.

**Key point:** The engineer (`admin_email`) still has access via their
personal devices — only the VM's machine-level access was revoked.
Identity and machine are two separate things in Zero Trust.

---

### 6. Show the IaC — `terraform plan`

```bash
cd Tailscale/terraform
terraform plan
```

No changes — shows the full provisioned state cleanly.
Walk through `acl.tf` and `tags.tf` — explain grants, tag ownership, WHY comments.

---

## Tag Ownership Chain — The Talking Points

### The Karen Framing (technical audience)

> *"Tailscale is the Karen. tag:server had no manager declared.
> Request denied."*

Without `tagOwners` declared, Terraform shows up to enroll a VM,
Tailscale asks "who authorized you to stamp this tag?" — no answer,
request rejected.

### The GoodLife Analogy (mixed or non-technical audience)

> *"A gym franchise wants to open 10 branches without flying out
> corporate staff to each one. They hire a licensed contractor —
> but the contractor can only issue official location tags if Corp
> has credentialed them first. Without that chain declared upfront,
> the branch opens but the system rejects it."*

### The Actual Chain

```
admin_email (GLCorp / you)
  → declares in tagOwners → tag:terraform (the credentialed contractor)
    → OAuth client assigned → tag:terraform (admin console)
      → tag:terraform owns → tag:server
      → tag:terraform owns → tag:subnet-router
```

**Why not `admin_email` directly owning `tag:server`?**  
For manual tagging it works — but Terraform's OAuth client is not
`admin_email`. When Terraform requests an auth key at 2am with no
human present, Tailscale asks: "does the OAuth client own this tag?"
The chain must be declared through `tag:terraform`, not through you personally.

**The closer:**
> *"Authentication proves who you are.
> Authorization defines what you can do.
> Tailscale enforces both — and it wants to speak to the manager first."*

---

## Auth Keys — Automated Device Enrollment

Auth keys allow a VM to join the Tailnet without a human logging in.
`keys.tf` generates the key via Terraform:

```hcl
resource "tailscale_tailnet_key" "vm_auth_key" {
  reusable      = false   # single-use — limits blast radius
  ephemeral     = false   # VM persists after going offline
  preauthorized = true    # no manual approval needed
  expiry        = 3600    # 1 hour — use immediately
  tags          = [var.tag_server]
}
```

Retrieve and use after apply:
```bash
sudo tailscale up --authkey=$(terraform output -raw vm_auth_key) --ssh
```

**Secret sprawl prevention:**
- `sensitive = true` — key never printed in plain text during plan/apply
- Retrieved only via `terraform output -raw` at runtime
- Never stored in tfvars, never in Git
- Expires in 1 hour — useless if leaked after use

---

## Tailscale SSH — Three Layers

| Layer | Tool | What it does |
|---|---|---|
| Feature per machine | `sudo tailscale set --ssh` on Linux CLI | Tells the daemon to accept SSH on this device |
| Who can SSH to what | `acl.tf` SSH block via Terraform | Declares source, destination, Linux users |
| Tailnet-level settings | `tailnet_settings.tf` | HTTPS certs, device settings — not SSH |

Terraform manages the policy layer. The machine opt-in is a CLI step —
this is the IaC boundary. Cannot be automated via Terraform provider.

---

## Greenfield Deployment — What terraform apply Does

On a brand new Tailnet, Tailscale creates a default allow-all policy.
Our `acl.tf` import block adopts it on first apply and overwrites it
with least-privilege grants. Zero manual ACL editing required.

**If asked to demo this live:**
Admin console → Access Controls → Restore defaults →
`terraform apply` → our policy overwrites the default. Confirmed safe.

---

## IaC Boundary — What Terraform Can and Cannot Do

| Terraform manages | Manual steps required |
|---|---|
| ACL policy | Install Tailscale on each device |
| Device tags | Enroll devices into Tailnet |
| Subnet route approvals | Enable subnet router on Apple TV |
| Auth key generation | Run `tailscale up --authkey=...` on VM |
| MagicDNS + HTTPS certs | Enable Tailscale SSH per machine (`sudo tailscale set --ssh`) |

---

## Official References

| Topic | URL |
|---|---|
| Tailscale Terraform provider | https://tailscale.com/kb/1210/terraform-provider |
| Auth keys | https://tailscale.com/docs/features/access-control/auth-keys |
| Tag owners syntax | https://tailscale.com/docs/reference/syntax/policy-file#tag-owners |
| Tags and ownership | https://tailscale.com/docs/features/tags#ownership |
| Tailscale SSH | https://tailscale.com/docs/features/tailscale-ssh |
| OAuth clients | https://tailscale.com/docs/features/oauth-clients |
| OAuth tag ownership issue | https://github.com/tailscale/tailscale/issues/8299 |
| HA subnet routing | https://tailscale.com/docs/how-to/set-up-high-availability |
| Exit nodes | https://tailscale.com/kb/1103/exit-nodes |