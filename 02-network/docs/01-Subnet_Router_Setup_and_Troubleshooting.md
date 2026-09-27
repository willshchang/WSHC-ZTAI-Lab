# Tailscale Subnet Router — Setup and Troubleshooting

**Document Type:** Admin Technical Reference  
**Author:** Will Chang, Tailscale Customer Success Engineer  
**Audience:** IT Administrator / Tailscale CSE Reference  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-ZeroTrust-IaC-Lab  
**Official Reference:** https://tailscale.com/docs/features/subnet-routers

---

## Overview

This document covers the complete setup, verification, and 
troubleshooting process for Tailscale subnet routers. It 
combines a general platform-agnostic troubleshooting reference 
with a lab-specific learning journal — including commands that 
didn't work, why they failed, and what the correct approach was.

**Lab topology:**
- **Site A (Cloud):** Azure VM (`tinyco-vm`) — Ubuntu 24.04, 
  Tailscale IP `100.93.4.6`
- **Site B (Home LAN):** Two Apple TVs — HA subnet routers 
  advertising `192.168.1.0/24`
  - Primary: `iwilltvliving` — ethernet, `100.109.140.74`
  - Secondary: `iwilltvmaster` — WiFi, `100.122.120.115`
- **Home network:** Telus fibre modem (`192.168.1.254`) → 
  ASUS router in AP mode (`192.168.1.59`)

**Goal:** Azure VM (Site A) reaches non-Tailscale devices on 
the home LAN (`192.168.1.0/24`) through the Apple TV subnet 
router (Site B) with automatic HA failover.

---

## What is a Subnet Router?

A subnet router is a Tailscale device that acts as a gateway 
between your Tailnet and a physical subnet — allowing Tailscale 
devices to reach non-Tailscale devices on that subnet without 
installing Tailscale on every device.

**Key distinctions:**

| Feature | Subnet Router | Exit Node |
|---|---|---|
| **Purpose** | Access specific private subnets | Route all internet traffic |
| **Internet traffic** | Not affected | Routed through exit node |
| **Use case** | Office LAN, cloud VPC, legacy devices | Privacy, geo-routing |
| **Devices covered** | Non-Tailscale LAN devices | All internet traffic |

**Why it matters:**
Devices like printers, routers, modems, cameras, and legacy 
systems can't run Tailscale. A subnet router extends Tailscale's 
Zero Trust security model to cover these devices without 
requiring client installation.

**Official reference:**
https://tailscale.com/docs/features/subnet-routers

---

## Lab Network Explained

Before troubleshooting subnet routing, understand your network 
topology:

```bash
ipconfig          # Windows
ifconfig          # macOS/Linux
ip addr show      # Linux (modern)
```

**Key terms:**

| Term | Definition |
|---|---|
| **Default Gateway** | Device routing traffic from LAN to internet — usually router or modem |
| **Subnet** | Range of IP addresses on the same local network |
| **AP Mode** | Access Point mode — provides WiFi only, does not route traffic |
| **SNAT** | Source NAT — subnet router rewrites source IP so return traffic routes correctly |
| **IP Forwarding** | Kernel setting allowing a device to forward packets between interfaces |
| **Double NAT** | Two NAT layers (e.g. modem + router) — blocks WireGuard direct P2P connections |

**Lab network breakdown:**
- `192.168.1.254` — Telus fibre modem (actual default gateway)
- `192.168.1.59` — ASUS router in AP mode (WiFi only, not routing)
- `192.168.1.157` — Windows PC (Tailscale device, direct Tailnet member)
- `192.168.1.0/24` — full home subnet advertised by Apple TVs

> **Note:** When the ASUS router is in AP mode, the modem 
> (`192.168.1.254`) is the real gateway — not the typical 
> `192.168.1.1`. Always verify with `ipconfig` before 
> assuming gateway IP.

---

## Setup — Apple TV (tvOS) as Subnet Router

Apple TV (tvOS) is one of the simplest subnet router platforms — 
no CLI required, no IP forwarding configuration needed. tvOS 
handles this automatically.

1. Install **Tailscale** from the App Store on Apple TV
2. Sign in with your Tailscale account
3. Go to **Settings** in the Tailscale app
4. Enable **Subnet Router**
5. Enable **Allow Local Network Access**
6. The Apple TV advertises its local subnet automatically

**Official tvOS reference:**
https://tailscale.com/docs/features/subnet-routers?tab=tvos

### Admin Console — Approve the Route

After the Apple TV advertises its subnet:

1. Go to **login.tailscale.com/admin/machines**
2. Find your Apple TV device
3. Click on it → find the **Subnets** section
4. Check the checkbox next to `192.168.1.0/24`
5. Click **Save**

> **UI note:** The Tailscale admin console no longer shows 
> "Approved/Advertised" labels explicitly. A checkmark ✅ 
> next to the subnet means it is approved and active.

---

## Setup — Linux as Subnet Router

Linux requires two explicit steps that other platforms 
handle automatically.

### Step 1 — Enable IP Forwarding

IP forwarding allows the Linux kernel to forward packets 
between interfaces — essential for a subnet router.

```bash
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
echo 'net.ipv6.conf.all.forwarding = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

### Step 2 — Advertise Subnet Routes

```bash
sudo tailscale set --advertise-routes=192.168.1.0/24
```

**Official Linux reference:**
https://tailscale.com/docs/features/subnet-routers?tab=linux

---

## Setup — Linux Client Accepting Subnet Routes

**This is the most commonly missed step on Linux.**

Windows, macOS, iOS, and tvOS automatically accept advertised 
subnet routes. Linux does not — it requires explicit opt-in:

```bash
sudo tailscale set --accept-routes
```

**Why Linux requires this:**
It is a deliberate security measure. A rogue subnet router 
cannot automatically inject routes into a Linux device's 
routing table without explicit consent.

**Verify:**
```bash
tailscale status --self
```

Look for `accept-routes=true` in the output.

---

## Universal Diagnostic Commands

Run these first on any subnet router issue — in this order:

```bash
# 1. Check device and connection status
tailscale status

# 2. Check active subnet routes — correct tool for Tailscale
tailscale status --json | python3 -c "
import json,sys
data=json.load(sys.stdin)
for peer in data.get('Peer',{}).values():
    routes=peer.get('PrimaryRoutes',[])
    advertised=peer.get('AdvertisedRoutes',[])
    if routes or advertised:
        print(peer['HostName'])
        print('  Primary:', routes)
        print('  Advertised:', advertised)
"

# 3. Check this device's Tailscale config flags
tailscale status --self

# 4. Check network environment (NAT type, DERP latency)
tailscale netcheck

# 5. Ping subnet router Tailscale IP first
ping -c 4 

# 6. Then ping a device behind the subnet router
ping -c 4 
```

### Understanding `ping -c 4`

- `-c` = **count** — number of packets to send
- `4` = send exactly 4 packets then stop

Without `-c`, Linux ping runs indefinitely until `Ctrl+C`. 
Using `-c 4` is standard for quick connectivity verification.

---

## Identify the Failure Layer First

Before changing any configuration, determine which layer 
the issue lives in:

| Layer | Tool | What it covers |
|---|---|---|
| **Tailscale** | `tailscale status`, admin console | Routes, ACL, device connectivity |
| **Network/OS** | `ip route`, `traceroute`, firewall | Kernel routing, NAT, IP forwarding |
| **Cloud** | NSG, security groups | Azure/AWS/GCP traffic rules |

**Always start at the Tailscale layer.** Most subnet issues 
are configuration, not network.

### The Wrong Tool — `ip route show`

```bash
ip route show
```

**This is the wrong tool for Tailscale subnet issues.**

`ip route show` displays the Linux kernel routing table. 
Tailscale manages subnet routes in its own internal routing 
layer — intercepting packets before they reach the kernel. 
A subnet like `192.168.1.0/24` will never appear in 
`ip route show` even when Tailscale subnet routing works 
perfectly.

**When `ip route show` IS useful:**
- Diagnosing kernel-level routing issues
- Verifying static routes
- Checking default gateway configuration
- Asymmetric routing issues (see Issue 6 below)

---

## Correct Troubleshooting Flow
```
ping fails to subnet device
↓
tailscale status
→ Is the subnet router connected? (not offline or -)
↓
tailscale status --json | grep PrimaryRoutes
→ Is the subnet showing under PrimaryRoutes?
→ If not → check admin console subnet approval ✅
↓
sudo tailscale set --accept-routes  (Linux clients only)
→ Did the Linux client accept routes?
↓
ping subnet router Tailscale IP first
→ Can you reach the subnet router device itself?
↓
ping device on subnet
→ 192.168.1.254 (modem), 192.168.1.59 (AP)
↓
If still failing → check ACL policy
→ Is traffic from source to 192.168.1.0/24 permitted?
↓
If cloud environment → check security groups/NSG
→ Is inbound/outbound subnet traffic allowed?
```
---

## Common Issues

### Issue 1 — Linux client cannot reach subnet devices

**Symptom:** Ping to subnet devices fails from Linux, even 
though subnet router is connected and route is approved.

**Cause:** Linux does not automatically accept subnet routes.

**Fix:**
```bash
sudo tailscale set --accept-routes
```

---

### Issue 2 — Route not appearing in PrimaryRoutes

**Symptom:** `tailscale status --json` shows empty 
`PrimaryRoutes` for subnet router.

**Cause:** Route advertised but not approved in admin console.

**Fix:**
Admin console → Machines → find subnet router → 
Subnets → check `192.168.1.0/24` ✅ → Save

---

### Issue 3 — Can reach subnet router, not devices behind it

**Symptom:** Ping to subnet router's Tailscale IP succeeds. 
Ping to `192.168.1.x` devices fails.

**Cause A — Linux IP forwarding not enabled:**
```bash
# Check current status
sysctl net.ipv4.ip_forward

# Fix
echo 'net.ipv4.ip_forward = 1' | sudo tee -a /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
```

**Cause B — ACL blocking traffic:**
Check `login.tailscale.com/admin/acls` — ensure grant exists:
```json
{
    "src": ["your-user-or-device"],
    "dst": ["192.168.1.0/24"],
    "ip":  ["*"]
}
```

**Note:** "ACL blocking subnet traffic only becomes an issue once you've replaced the default allow-all grant with explicit least-privilege grants."

---

### Issue 4 — Cloud subnet router not forwarding traffic

**Symptom:** Subnet router on Azure, AWS, or GCP — devices 
behind it unreachable despite correct Tailscale config.

**Cause:** Cloud security groups or NSGs blocking forwarded 
traffic.

**Fix — Azure NSG:**
- Allow inbound traffic on the subnet CIDR
- Allow outbound traffic to the subnet CIDR
- Test by temporarily allowing all internal traffic

**Fix — AWS Security Groups:**
- Allow all traffic on the internal subnet for testing
- Narrow down rules after confirming connectivity

> **Official guidance:**
> https://tailscale.com/docs/reference/troubleshooting/cloud/subnet-connectivity

---

### Issue 5 — Subnet router was working, now stopped

**Symptom:** Subnet routing was working, then stopped without 
any obvious changes.

| Cause | Check | Fix |
|---|---|---|
| Key expiry | Admin console → device key status | Disable key expiry |
| IP forwarding reset on reboot | `sysctl net.ipv4.ip_forward` | Make sysctl persistent |
| ACL policy changed | Admin console → ACLs | Review recent changes |
| Device IP changed | `tailscale status` | Update any hardcoded IPs |

> **Key expiry is critical for subnet routers.** When a 
> subnet router's key expires, the routes remain configured 
> on client devices but become unreachable. Always disable 
> key expiry on subnet router devices.
>
> Admin console → Machines → device → three dots → 
> Disable key expiry

**Official reference:**
https://tailscale.com/docs/features/access-control/key-expiry

---

### Issue 6 — Asymmetric routing on Linux

**Symptom:** Devices on the same LAN as a Linux subnet 
router cannot reach each other reliably. Ping requests 
arrive but replies don't return.

**Diagnostic:**
```bash
# Run tcpdump on the affected device
sudo tcpdump -i any icmp and host <target-ip>
```

Look for: request arriving on `eth0` but reply leaving 
on `tailscale0` — that's asymmetric routing.

**Why this happens:**
When a Linux device advertises a subnet it's also connected 
to, Tailscale adds that subnet to routing table 52. Return 
traffic from LAN devices gets routed through Tailscale 
instead of directly across the LAN.

**Fix — add a policy routing rule:**
```bash
sudo ip rule add from 192.168.1.0/24 to 192.168.1.0/24 \
    lookup main priority 99
```

**Make persistent:**
```bash
cat > /etc/network/if-up.d/local-routing << 'EOF'
#!/bin/bash
ip rule add from 192.168.1.0/24 to 192.168.1.0/24 \
    lookup main priority 99 2>/dev/null || true
EOF
chmod +x /etc/network/if-up.d/local-routing
```

---

### Issue 7 — Overlapping subnet routes — traffic black hole

**Symptom:** Two subnet routers advertise overlapping routes 
with different prefix lengths (e.g. `10.0.0.0/16` and 
`10.0.0.0/24`). More-specific router goes offline — traffic 
drops entirely even though less-specific router is available.

**Cause:** Tailscale uses longest prefix matching. When the 
more-specific router goes offline, Tailscale does not 
automatically fall back to the less-specific route — it 
drops traffic instead.

**Fix:** Configure all subnet routers advertising a broader 
prefix to also advertise the more-specific prefix:
Before (broken):
Router A: 10.0.0.0/16
Router B: 10.0.0.0/24
After (HA-safe):
Router A: 10.0.0.0/16 AND 10.0.0.0/24
Router B: 10.0.0.0/24

Both routers are now candidates for `/24` traffic — 
failover works correctly.

**Official reference:**
https://tailscale.com/docs/reference/troubleshooting/network-configuration/overlapping-subnet-route-failover

---

### Issue 8 — HA failover not working

**Symptom:** Primary subnet router goes offline but 
secondary does not take over.

**Checklist:**
1. Does secondary advertise the **exact same** subnet? 
   (`192.168.1.0/24` ≠ `192.168.1.0/25`)
2. Is secondary route approved in admin console? ✅
3. Is `--accept-routes` enabled on client devices? (Linux)

**Verify both routers:**
```bash
tailscale status --json | python3 -c "
import json,sys
data=json.load(sys.stdin)
for peer in data.get('Peer',{}).values():
    routes=peer.get('PrimaryRoutes',[])
    advertised=peer.get('AdvertisedRoutes',[])
    if routes or advertised:
        print(peer['HostName'])
        print('  Primary:', routes)
        print('  Advertised:', advertised)
"
```

**Expected healthy HA output:**
iwilltvliving
Primary: ['192.168.1.0/24']
Advertised: []
iwilltvmaster
Primary: []
Advertised: ['192.168.1.0/24']

The `-` in `tailscale status` for the standby router is 
correct — it means standby, not broken.

> **Failover timing:** Tailscale fails over to the next 
> subnet router approximately 15 seconds after the primary 
> goes offline.

**Official HA reference:**
https://tailscale.com/docs/how-to/set-up-high-availability

---

### Issue 9 — High latency via subnet router

**Symptom:** High latency, especially on first packet.

**Diagnosis:**
```bash
tailscale status
# Look for: relay: sea (DERP) vs direct
```

| Connection | Latency | Cause |
|---|---|---|
| `direct` | 5–30ms | P2P WireGuard tunnel |
| `relay: sea` | 50–300ms | DERP relay (NAT traversal) |

**First packet spike is normal:**
The first packet via DERP initiates path negotiation. 
Subsequent packets drop to steady-state latency once 
the path is cached.

**Improve direct connection:**
Enable UDP port `41641` forwarding on your router pointing 
to the subnet router's LAN IP.

> DERP relay is not a failure — it is Tailscale's deliberate 
> design for networks where direct P2P is not possible. 
> Traffic remains end-to-end encrypted regardless.

**Official DERP reference:**
https://tailscale.com/blog/how-tailscale-works

---

### Issue 10 — Subnet accessible from some devices but not others

**Symptom:** One device reaches the subnet, another cannot — 
same tailnet.

**Cause A:** Different `accept-routes` settings per device.
```bash
# On the failing device (Linux)
tailscale status --self | grep accept-routes
```

**Cause B:** ACL policy restricts by user/device identity.

Admin console → **Access Controls** → use **Test access** 
to simulate access from the failing device's identity to 
the subnet destination.

---

## DERP vs Direct Connection
tailscale status output:
iwillwindows       active; direct 108.173.x.x:41641
iwilltvliving      idle; relay: sea

**Direct connection** — P2P WireGuard tunnel. Best performance.

**DERP relay** — Tailscale routes through a relay server when 
direct P2P is not possible. Traffic is still end-to-end 
encrypted — DERP only sees encrypted packets, never content.

**DERP = Detoured Encrypted Routing Protocol**

**Why Apple TV uses DERP in this lab:**
Double NAT (Telus modem + ASUS AP mode) blocks WireGuard's 
UDP hole-punching. DERP handles this automatically with no 
configuration required.

**Impact on latency:**
- First ping: `~300ms` — DERP relay negotiation
- Subsequent pings: `~74ms` — path optimised and cached

**Official DERP reference:**
https://tailscale.com/blog/how-tailscale-works

---

## High Availability — Multiple Subnet Routers

Tailscale supports multiple devices advertising the same 
subnet for redundancy.

**How it works:**
- Two devices both advertise `192.168.1.0/24`
- Tailscale selects one as primary (`PrimaryRoutes`)
- If primary goes offline → automatic failover to secondary
- Clients require zero configuration changes

**Lab HA test — verified results:**

| Test | Result |
|---|---|
| Primary subnet router disabled | `iwilltvmaster` automatically became primary |
| Ping to `192.168.1.254` after failover | ✅ 4/4 packets received |
| Connection type | DERP relay Seattle (WiFi + NAT on bedroom Apple TV) |
| Client reconfiguration needed | ❌ None — fully automatic |
| Time to failover | ~5 seconds |

**Perform HA failover test:**
1. Admin console → `iwilltvliving` → Edit route settings → 
   uncheck `192.168.1.0/24` → Save
2. Wait 5 seconds
3. From Azure VM: `ping -c 4 192.168.1.254`
4. Restore: re-check `192.168.1.0/24` on `iwilltvliving`

**Production framing:**

In this lab, both Apple TVs share the same physical subnet — 
demonstrating HA failover. In production, each subnet router 
would sit on a different physical network:

| Device | Subnet | Represents |
|---|---|---|
| HQ subnet router | `192.168.1.0/24` | Corporate HQ LAN |
| Branch subnet router | `10.10.0.0/24` | Branch office LAN |
| Cloud subnet router | `10.0.0.0/24` | Azure VPC |

**Official HA reference:**
https://tailscale.com/docs/how-to/set-up-high-availability

---

## Diagnostic Command Reference

| Command | What it shows | When to use |
|---|---|---|
| `tailscale status` | Device list, connection type, online status | First check always |
| `tailscale status --json \| grep PrimaryRoutes` | Active subnet routes | Verify route is active |
| `tailscale status --self` | This device's config flags | Check accept-routes |
| `tailscale ping <host>` | Latency + path type | Diagnose connection quality |
| `tailscale netcheck` | NAT type, DERP latency per region | Network environment check |
| `ping -c 4 <ip>` | Basic end-to-end connectivity | Always step before escalating |
| `traceroute <ip>` | Hop-by-hop path | Where traffic is dropping |
| `ip route show` | Linux kernel routing table | Non-Tailscale routing only |
| `sysctl net.ipv4.ip_forward` | IP forwarding status | Linux subnet router check |
| `tailscale bugreport` | Compressed log bundle for support | Escalating to Tailscale |

---

### Extended Discovery — Including Self and Device Settings

## Discovering Subnet Routers via CLI

The Tailscale admin console shows subnet routers visually 
via the **Subnets** badge. For CLI-based discovery — useful 
for scripting, automation, or remote troubleshooting — use 
the following command from any device on your tailnet.

### Identify All Active Subnet Routers

Run from any connected Tailscale device:

```bash
tailscale status --json | python3 -c "
import json,sys
data=json.load(sys.stdin)

# Check if this device itself is a subnet router
self = data.get('Self', {})
self_routes = self.get('PrimaryRoutes', []) or \
              self.get('AdvertisedRoutes', [])
if self_routes:
    print('[SELF]', self.get('HostName'))
    print('  Routes:', self_routes)

# Check all peers
for peer in data.get('Peer',{}).values():
    routes = peer.get('PrimaryRoutes',[])
    advertised = peer.get('AdvertisedRoutes',[])
    if routes or advertised:
        print('[PEER]', peer['HostName'], '—', peer['OS'])
        print('  Primary:', routes)
        print('  Advertised:', advertised)
"
```

**Example output — lab environment:**
[PEER] iwilltvliving — tvOS
Primary: ['192.168.1.0/24']
Advertised: []
[PEER] iwilltvmaster — tvOS
Primary: []
Advertised: ['192.168.1.0/24']

**Reading the output:**

| Field | Meaning |
|---|---|
| `[SELF]` | This device is a subnet router |
| `[PEER]` | Another device on the tailnet |
| `Primary` | Active subnet router for this range |
| `Advertised` | Standby — advertising but not primary (HA) |
| Empty both | Not a subnet router |

> **Note on display names:** The CLI shows Tailscale hostnames 
> (e.g. `iwilltvliving`) — not the custom display names set 
> in the admin console. For human-readable names, the admin 
> console **Machines** page remains the clearest reference.

### Check Your Own Device's Route Settings

```bash
tailscale debug prefs | grep -i route
```

**Key fields to look for:**

| Field | Value | Meaning |
|---|---|---|
| `RouteAll` | `true` | This device accepts all subnet routes |
| `AdvertiseRoutes` | `["192.168.1.0/24"]` | This device is a subnet router |
| `AdvertiseRoutes` | `["0.0.0.0/0", "::/0"]` | This device is an exit node |

> **Lab discovery:** Running `tailscale debug prefs` on the 
> Windows PC revealed it was advertising `0.0.0.0/0` and 
> `::/0` — confirming it was operating as an exit node. 
> This is visible in `tailscale status` as `offers exit node` 
> next to the device.

### When to Use CLI vs Admin Console

| Scenario | Best tool |
|---|---|
| Quick visual overview of all devices | Admin console |
| Scripting or automation | CLI — `tailscale status --json` |
| Verifying during live troubleshooting | CLI — faster, no browser needed |
| Checking your own device settings | CLI — `tailscale debug prefs` |
| Approving subnet routes | Admin console only |

---

## `tailscale netcheck` — Underused but Powerful

```bash
tailscale netcheck
```

Shows:
- **NAT type** — easy/hard/symmetric — affects direct 
  connection probability
- **DERP relay latency** per region — shows closest relay
- **UDP availability** — if blocked, only DERP works
- **IPv6 availability**

Run this first when diagnosing DERP vs direct issues.

---

## Generate a Bug Report

When escalating to Tailscale support:

```bash
tailscale bugreport
```

Generates a compressed log bundle with Tailscale state, 
logs, and network configuration. Attach to support tickets.

**Official reference:**
https://tailscale.com/docs/account/bug-report

---

## Common Failure Points — Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| Ping fails, subnet router connected | Linux not accepting routes | `sudo tailscale set --accept-routes` |
| Subnet not in PrimaryRoutes | Route not approved in admin console | Admin console → approve ✅ |
| Ping fails after accept-routes | ACL blocking traffic | Add grant in ACL policy |
| Can reach router, not subnet devices | IP forwarding disabled (Linux) | Enable ip_forward via sysctl |
| Cloud subnet not reachable | Security group/NSG too restrictive | Allow subnet traffic in cloud firewall |
| Subnet router stopped working | Key expiry | Disable key expiry on router device |
| High latency first ping | DERP relay negotiating | Expected — subsequent pings normalise |
| Direct connection failing | Double NAT / UDP blocked | DERP handles automatically |
| LAN devices unreachable from same subnet | Asymmetric routing | Add policy routing rule |
| HA failover not working | Different subnet prefix advertised | Ensure exact same subnet on both routers |
| Overlapping routes drop traffic | Black hole on more-specific prefix | Advertise specific prefix on all routers |

---

## Key Lessons Learned

**1. Use the right diagnostic layer**
`ip route show` is for kernel routing — not Tailscale routing. 
Always start with `tailscale status --json` for Tailscale issues.

**2. Linux requires explicit route acceptance**
Windows, macOS, iOS, and tvOS accept subnet routes automatically. 
Linux always requires `--accept-routes`. Intentional security 
design, not a bug.

**3. Admin console approval is required**
Advertising a subnet is not enough — the route must also be 
approved in the admin console. Checkmark ✅ = approved.

**4. DERP is not a failure**
`relay: sea` in `tailscale status` is not an error. DERP 
provides connectivity where direct P2P isn't possible, with 
full end-to-end encryption maintained.

**5. Identify the network layer before troubleshooting**
> "Is this a Tailscale layer issue or a network layer issue?"

Tailscale layer → `tailscale status`, admin console, ACL policy  
Network layer → `ip route`, `traceroute`, `ping`, firewall rules

**6. Always disable key expiry on subnet routers**
Key expiry causes silent failures — routes remain configured 
but become unreachable. Disable it on all infrastructure devices.

---

## Official References

| Topic | URL |
|---|---|
| Subnet routers | https://tailscale.com/docs/features/subnet-routers |
| HA subnet routing | https://tailscale.com/docs/how-to/set-up-high-availability |
| Site-to-site networking | https://tailscale.com/docs/features/site-to-site |
| ACL policy syntax | https://tailscale.com/docs/reference/syntax/policy-file |
| Troubleshooting guide | https://tailscale.com/docs/reference/troubleshooting |
| Device connectivity | https://tailscale.com/kb/1463/troubleshoot-connectivity |
| Cloud subnet troubleshooting | https://tailscale.com/docs/reference/troubleshooting/cloud/subnet-connectivity |
| Overlapping route failover | https://tailscale.com/docs/reference/troubleshooting/network-configuration/overlapping-subnet-route-failover |
| Key expiry | https://tailscale.com/docs/features/access-control/key-expiry |
| DERP explanation | https://tailscale.com/blog/how-tailscale-works |
| Generate bug report | https://tailscale.com/docs/account/bug-report |