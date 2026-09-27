# Tailscale IaC — tailnet_settings.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_settings

---

## Overview

`tailnet_settings.tf` manages global Tailnet settings — HTTPS 
certificate provisioning and device auto-updates.

---

## Import Block

```hcl
import {
  to = tailscale_tailnet_settings.main
  id = "settings"
}
```

Required OAuth scope: **Settings → Networking Settings → Write**

---

## HTTPS Certificates

```hcl
https_enabled = true
```

Enables Tailscale to provision valid Let's Encrypt TLS certificates 
per device via MagicDNS hostname:
tinyco-vm.hair-squeaker.ts.net

Used in this lab for Mattermost HTTPS via Tailscale Serve — 
eliminates self-signed certificate warnings without purchasing 
a domain.

**Provision cert on a device after enabling:**
```bash
sudo tailscale cert tinyco-vm.hair-squeaker.ts.net
```

> **Requires MagicDNS** — enable in `dns.tf` first.

---

## Device Auto-Updates

```hcl
devices_auto_updates_on = true
```

Tailscale clients update automatically — ensures latest WireGuard 
and security patches across all devices without manual intervention.

---

## Future Expansion

```hcl
# devices_approval_on = true
# Require admin approval before new devices join tailnet

# devices_key_duration_days = 180
# How long before device keys expire

# acls_externally_managed_on = true
# acls_external_link = "https://github.com/yourorg/tailscale-acls"
# Lock ACL editing in admin console — enforce GitOps workflow
```

---

## Official References

| Topic | URL |
|---|---|
| Tailnet settings resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/tailnet_settings |
| HTTPS certificates | https://tailscale.com/kb/1153/enabling-https |