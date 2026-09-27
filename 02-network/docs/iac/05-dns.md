# Tailscale IaC — dns.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/dns_preferences

---

## Overview

`dns.tf` manages MagicDNS for the Tailnet via Terraform. HTTPS 
certificate provisioning is managed separately in `tailnet_settings.tf`.

---

## Import Block

Tailscale creates default DNS preferences on every new Tailnet. 
Import block brings existing config into state before managing:

```hcl
import {
  to = tailscale_dns_preferences.main
  id = "dns_preferences"
}
```

---

## MagicDNS

```hcl
resource "tailscale_dns_preferences" "main" {
  magic_dns = true
}
```

**Why MagicDNS matters:**
Without MagicDNS, devices are reached only by Tailscale IP 
(e.g. `100.93.4.6`). With MagicDNS, devices resolve by hostname 
(e.g. `tinyco-vm.hair-squeaker.ts.net`) — making the Tailnet 
feel like a real corporate LAN regardless of physical location.

MagicDNS is required for:
- HTTPS certificates via `tailnet_settings.tf`
- Tailscale Serve (HTTPS termination for Mattermost)
- Human-readable SSH targets (`tailscale ssh tinyco-vm`)

---

## Provider Limitation

The `tailscale_dns_preferences` resource only exposes `magic_dns` — 
HTTPS certificate enabling is not available via this resource. It is 
managed via `tailscale_tailnet_settings` in `tailnet_settings.tf`.

Confirmed via provider schema:
```bash
terraform providers schema -json | python3 -c "
import json,sys
schema=json.load(sys.stdin)
dns=schema['provider_schemas']['registry.terraform.io/tailscale/tailscale']['resource_schemas'].get('tailscale_dns_preferences',{})
print(json.dumps(dns.get('block',{}).get('attributes',{}), indent=2))
"
```

---

## Future Expansion

Custom DNS nameservers and split DNS — requires a registered domain:

```hcl
resource "tailscale_dns_nameservers" "custom" {
  nameservers = ["8.8.8.8", "8.8.4.4"]
}

resource "tailscale_dns_split_nameservers" "internal" {
  domain      = "yourdomain.com"
  nameservers = ["10.0.0.53"]
}
```

---

## Official References

| Topic | URL |
|---|---|
| DNS preferences resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/dns_preferences |
| MagicDNS | https://tailscale.com/kb/1081/magicdns |