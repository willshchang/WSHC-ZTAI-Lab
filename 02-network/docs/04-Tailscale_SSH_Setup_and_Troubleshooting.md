# Tailscale SSH Setup and Troubleshooting

**Document Type:** Admin Technical Reference  
**Author:** Will Chang, Tailscale Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/docs/features/tailscale-ssh

---

## Overview

This document covers Tailscale SSH setup, configuration, and 
troubleshooting — with a focus on how Tailscale SSH handles 
identity and why Linux usernames are still required even with 
identity-based authentication.

For network architecture and ACL policy context, see:
- [02-Tailscale_ACL_Tags_and_Access_Control.md](./02-Tailscale_ACL_Tags_and_Access_Control.md)
- [03-Tailscale_Network_Architecture.md](./03-Tailscale_Network_Architecture.md)

---

## Part 1 — How Tailscale SSH Handles Identity

### Two Separate Identity Layers

Tailscale SSH handles two distinct identity layers that are 
often confused:

| Layer | What it does | Tool |
|---|---|---|
| **Authentication** | Verifies WHO you are — no SSH keys needed | Tailscale identity (Gmail / Entra SSO) |
| **Authorization** | Determines WHICH Linux user you log in as | Linux user account on destination VM |

**Common misconception:**
> *"Tailscale SSH uses my identity so it automatically knows 
> my username"*

**Reality:** Tailscale SSH removes the need for SSH keys — 
but it still needs to know which Linux user account to log 
you into on the destination machine. These are two completely 
separate things.

---

### Linux Users vs Windows / Tailscale Identity

When you SSH into a Linux VM, you are logging into a Linux 
user account that exists ON that VM — completely separate 
from your Windows identity or Tailscale email.

**Linux users on the Azure VM:**
- `tinyco-admin` — created during VM setup
- `iwill` — created during Tailscale SSH lab setup
- `root` — Linux superuser

Your Windows PC name (`iWillWindows`) is NOT a Linux user — 
it only exists on your Windows machine. SSH has no knowledge 
of Windows usernames.

**This is why you must always specify the Linux username:**

```bash
# ✅ Correct — specifies Linux user
tailscale ssh tinyco-admin@tinyco-vm
tailscale ssh iwill@tinyco-vm

# ❌ Fails — no Linux user matches Windows PC name
tailscale ssh tinyco-vm
# Error: failed to look up local user "IWILL-WINDOWS\\iwill"
```

---

### The ACL SSH Rule — Allowed Users

Your Tailscale ACL defines which Linux users are permitted:

```json
"ssh": [
    {
        "action": "accept",
        "src":    ["will.sh.chang@gmail.com"],
        "dst":    ["tag:server"],
        "users":  ["tinyco-admin", "iwill", "root"]
    }
]
```

**What this means:**
- `will.sh.chang@gmail.com` can SSH to `tag:server` devices
- But ONLY as Linux users: `tinyco-admin`, `iwill`, or `root`
- Any other Linux username = rejected even if Tailscale 
  identity is valid

---

### SSH Config File — Setting a Default User

To avoid typing the username every time, create an SSH 
config file on your Windows PC:

**File location:** `C:\Users\YourName\.ssh\config`
Host tinyco-vm
User iwill

Now `tailscale ssh tinyco-vm` automatically connects as 
`iwill` — no need to type `iwill@` every time.

**Multiple hosts:**
Host tinyco-vm
User iwill
Host work-server
User tinyco-admin

> **Note:** When creating this file via `nano` in Git Bash, 
> be careful not to accidentally write the word `nano` into 
> the file. Use `echo` instead:
> ```bash
> echo -e "Host tinyco-vm\n    User iwill" > ~/.ssh/config
> ```

---

## Part 2 — Common Errors and Fixes

### Error: `cannot find user <windows-username>`
tailscale: failed to look up local user "IWILL-WINDOWS\iwill"
Connection closed by UNKNOWN port 65535

**Cause:** No Linux username specified — SSH defaulted to 
Windows username which doesn't exist on the VM.

**Fix:** Always specify the Linux username:
```bash
tailscale ssh tinyco-admin@tinyco-vm
```

---

### Error: `tailnet policy does not permit you to SSH`
tailscale: tailnet policy does not permit you to SSH to this node
Connection closed by UNKNOWN port 65535

**Cause:** One of:
- Tag applied to device but ACL SSH grant not yet saved
- Your Tailscale identity not in the `src` list
- Linux username not in the `users` list

**Fix:** Verify SSH block in ACL policy:
```json
"ssh": [
    {
        "action": "accept",
        "src":    ["your-email@gmail.com"],
        "dst":    ["tag:server"],
        "users":  ["your-linux-username"]
    }
]
```

---

### Error: `Connection refused` or `Connection timed out`

**Cause:** One of:
- Port 22 blocked AND Tailscale SSH not enabled on destination
- Device offline or not connected to Tailnet
- ACL blocking the connection entirely

**Verify Tailscale SSH is enabled on destination:**
```bash
# On the destination VM
sudo tailscale set --ssh
tailscale status
```

---

### Error: `Access revoked` immediately after tagging device
Access revoked.
Connection to tinyco-vm.hair-squeaker.ts.net closed.

**Cause:** Applying a tag transfers device ownership from 
user account to the tag. User loses implicit access instantly — 
this is Zero Trust working correctly.

**Fix:** Save ACL with explicit grant BEFORE tagging, or 
immediately after tagging:

```json
"grants": [
    {
        "src": ["your-email@gmail.com"],
        "dst": ["tag:server"],
        "ip":  ["*"]
    }
]
```

> **Lesson learned:** Tag before grant = instant lockout. 
> Always write and save ACL grants before applying tags 
> to devices.

---

## Part 3 — Production Identity Mapping

In production environments, the Linux username mismatch is 
solved by having the IdP (Entra ID or Okta) automatically 
provision Linux user accounts — so your corporate identity 
maps directly to a Linux username.

**The production flow:**
User joins company
↓
Entra ID account created (will@company.com)
↓
SCIM provisions Linux user "will" on all servers
↓
Tailscale SSH: will@company.com → logs in as "will"
↓
No manual Linux user creation needed

**Tailscale SSH + Entra ID SSO in production:**

```json
"ssh": [
    {
        "action": "accept",
        "src":    ["group:engineering"],
        "dst":    ["tag:server"],
        "users":  ["autogroup:nonroot"]
    }
]
```

`autogroup:nonroot` — Tailscale automatically maps the 
user's Tailscale identity to a matching Linux username — 
no hardcoded usernames needed.

**Official reference:**
https://tailscale.com/kb/1337/acl-syntax

---

## Key Lessons

**1. Tailscale SSH = authentication without keys**
It verifies your identity so you don't need SSH keys. 
But you still need a Linux user account on the destination.

**2. Always specify Linux username before `@`**
`tailscale ssh linux-user@hostname` — always.

**3. SSH config file = quality of life improvement**
Set default username per host so you never have to type it.

**4. ACL users list must include your Linux username**
Even if your Tailscale identity is permitted, the Linux 
username must be in the `users` array.

**5. Tag before grant = instant lockout**
Always save ACL grants before applying tags to devices.

---

## Quick Reference

```bash
# SSH with explicit user (always works)
tailscale ssh tinyco-admin@tinyco-vm
tailscale ssh iwill@tinyco-vm

# Check if Tailscale SSH is enabled
tailscale status

# Verify SSH connectivity
tailscale ssh iwill@tinyco-vm echo "connection test"

# Enable Tailscale SSH on VM
sudo tailscale set --ssh

# Create Linux user on VM (if needed)
sudo adduser newusername
sudo usermod -aG sudo newusername

# Check existing Linux users on VM
cat /etc/passwd | grep -v nologin
```

---

## Official References

| Topic | URL |
|---|---|
| Tailscale SSH | https://tailscale.com/docs/features/tailscale-ssh |
| SSH ACL syntax | https://tailscale.com/kb/1193/tailscale-ssh |
| `autogroup:nonroot` | https://tailscale.com/kb/1337/acl-syntax |
| Tags and access control | https://tailscale.com/kb/1068/acl-tags |