# Tailscale IaC — tags.tf

**Document Type:** IaC Reference  
**Author:** Will Chang, Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_tags

---

## Overview

`tags.tf` assigns infrastructure tags to enrolled Tailnet devices 
using data sources to look up device IDs dynamically — zero 
hardcoded IDs.

---

## Data Sources — Dynamic Device Lookup

Device IDs are never hardcoded. Data sources look up the current 
ID by DNS name at plan time:

```hcl
data "tailscale_device" "vm" {
  name = var.vm_DNSname
}
```

**Why DNS name instead of hostname:**
Apple TV and some devices return generic hostnames (e.g. `apple-tv`) 
via the Tailscale API — both Apple TVs return the same hostname, 
making them indistinguishable. The full DNS name is always unique.

**Finding DNS names:**
```bash
tailscale status --json | python3 -c "
import json,sys
data=json.load(sys.stdin)
for peer in data.get('Peer',{}).values():
    print('HostName:', peer['HostName'])
    print('DNSName:', peer.get('DNSName',''))
    print('ID:', peer.get('ID',''))
    print('---')
"
```

---

## Tag Assignments

```hcl
resource "tailscale_device_tags" "vm" {
  device_id  = data.tailscale_device.vm.id
  tags       = [var.tag_server]
  depends_on = [tailscale_acl.policy]
}
```

**`depends_on` is critical** — `tagOwners` must be defined in 
`acl.tf` before tags can be assigned. Without this, Terraform 
may attempt to assign a tag before its owner is defined.

**Tagging transfers ownership:**
When a tag is applied, device ownership transfers from the user 
account to the tag. The user loses implicit access — access is 
then controlled exclusively by ACL grants.

**Real-time enforcement:**
Tag applied to tinyco-vm
↓ immediately
Access revoked.
Connection to tinyco-vm.hair-squeaker.ts.net closed.

This is Zero Trust working correctly — no grace period.

---

## Production Expansion

Add new tag assignments as infrastructure grows:

```hcl
resource "tailscale_device_tags" "database" {
  device_id  = data.tailscale_device.database.id
  tags       = ["tag:database"]
  depends_on = [tailscale_acl.policy]
}
```

Define the new tag in `acl.tf` `tagOwners` first.

---

## Official References

| Topic | URL |
|---|---|
| Device tags resource | https://registry.terraform.io/providers/tailscale/tailscale/latest/docs/resources/device_tags |
| Tags documentation | https://tailscale.com/kb/1068/acl-tags |