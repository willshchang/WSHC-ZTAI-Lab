# TinyCo — Tailscale VPN Troubleshooting Guide

**Document Type:** User Documentation  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** All TinyCo Employees  
**Last Updated:** April 2026  
**Reference:** https://tailscale.com/kb/

---

## Overview

This guide covers the most common Tailscale VPN issues TinyCo 
employees encounter and how to resolve them. If your issue is 
not listed here, contact ITOps via Mattermost `#it-support` 
or email `itops@TinyCoDDG.onmicrosoft.com`.

---

## Quick Checklist

Before contacting ITOps, run through this checklist:

- [ ] Tailscale is installed on your device
- [ ] You are signed in with your TinyCo email 
      (`firstname.lastname@TinyCoDDG.onmicrosoft.com`)
- [ ] Tailscale shows **Connected** in your system tray
- [ ] You can see `tinyco-vm` listed as a connected machine 
      in Tailscale
- [ ] You are using the correct URL for Mattermost:
      `https://tinyco-vm.hair-squeaker.ts.net/`

---

## Q: How do I grant a user Tailscale admin console access?

1. Go to https://login.tailscale.com/admin/users
2. Find the user → three dots → Change role → Admin

Note: This is separate from Entra group assignment. 
Tailscale admin console access is managed within Tailscale itself.

## Q: Tailscale shows "Connected" but I cannot reach Mattermost

**Symptoms:** Tailscale icon shows Connected but the Mattermost 
URL times out or shows an error page.

**Steps to resolve:**

1. Verify you are using the exact correct URL — copy and paste 
   this directly:
https://tinyco-vm.hair-squeaker.ts.net/

2. Click the Tailscale icon in your system tray → confirm 
   `tinyco-vm` appears in the list of connected machines with 
   a green dot

3. Test connectivity to the VM directly — open a terminal and run:
```bash
   ping 100.83.194.101
```
   If ping fails → the issue is Tailscale connectivity, 
   not Mattermost. Continue to the next steps.

4. Restart Tailscale:
   - **Windows:** right-click Tailscale in system tray → 
     **Restart**
   - **macOS:** menu bar → Tailscale → **Disconnect** → 
     wait 10 seconds → **Connect**

5. If still not working — sign out of Tailscale and sign 
   back in with your TinyCo email

---

## Q: Tailscale says "Logged out" or won't connect

**Symptoms:** Tailscale shows disconnected, asks you to log 
in again, or shows an authentication error.

**Steps to resolve:**

1. Click the Tailscale icon → **Log in**
2. Select **Sign in with Microsoft**
3. Sign in with your TinyCo email:
firstname.lastname@TinyCoDDG.onmicrosoft.com
4. Approve the MFA (Multi-Factor Authentication) prompt on 
   your phone
5. Wait 10–15 seconds for the connection to establish

> **This is normal.** Tailscale sessions expire periodically 
> as a security measure. Simply log in again — your settings 
> and access are preserved.

---

## Q: "This device needs to be approved" message

**Symptoms:** After logging in to Tailscale, you see a message 
stating your device is pending approval and cannot connect.

**What this means:** New devices must be approved by a 
Tailscale administrator before they can join the TinyCo network.

**Steps to resolve:**

Contact ITOps — a Tailscale administrator will approve your 
device in the admin portal. This typically takes less than 
one business day.

When contacting ITOps, provide:
- Your device name (shown in the Tailscale app)
- Your TinyCo email address
- The operating system of your device

> **Note:** Once approved, you will not need approval again 
> for the same device unless you reinstall Tailscale.

---

## Q: Tailscale is connected but my internet feels slow

**Symptoms:** Regular internet browsing is slower than usual 
when Tailscale is running.

**What this means:** You may have the Exit Node feature 
enabled, which routes all your internet traffic through the 
TinyCo VM. This is intended for specific use cases — it is 
not needed for regular work.

**Steps to resolve:**

1. Click the Tailscale icon in your system tray
2. Look for **Exit Node** in the menu
3. Select **None** to disable exit node routing

Your regular internet traffic will now go directly through 
your normal connection, while TinyCo internal resources 
remain accessible through Tailscale.

---

## Q: Cannot sign in — "Account locked" or too many failed 
attempts

**Symptoms:** Microsoft login shows your account is locked 
or you have exceeded the number of allowed sign-in attempts.

**Steps to resolve:**

1. Wait 15 minutes — Microsoft automatically unlocks accounts 
   after a cooling period
2. Reset your password at:
https://aka.ms/sspr
3. If still locked after resetting — contact ITOps immediately 
   as this may indicate an attempted account compromise

---

## Q: Microsoft Authenticator is not working

**Symptoms:** Microsoft Authenticator is not receiving push 
notifications, showing incorrect codes, or the app is not 
responding.

**Steps to resolve:**

1. Ensure your phone has an active internet connection — 
   Authenticator requires internet to receive push notifications

2. Check the time on your phone is correct — MFA codes are 
   time-sensitive and will fail if your phone clock is wrong:
   - **iOS:** Settings → General → Date & Time → 
     Set Automatically → On
   - **Android:** Settings → General Management → Date & Time → 
     Automatic date & time → On

3. Try using the 6-digit code manually instead of waiting 
   for a push notification — open Authenticator and tap your 
   TinyCo account to see the current code

4. If Authenticator is completely broken or you have a new 
   phone:
   - Go to `https://mysignins.microsoft.com/security-info`
   - Sign in and re-register your authenticator app
   - Contact ITOps if you cannot access this page

---

## Q: New laptop or phone — how do I set up Tailscale again?

**New laptop:**

1. Download Tailscale from `tailscale.com/download`
2. Install and open Tailscale
3. Click **Log in** → **Sign in with Microsoft**
4. Sign in with your TinyCo email
5. Contact ITOps to approve your new device

**New phone (Microsoft Authenticator):**

1. Download Microsoft Authenticator on your new phone
2. Go to `https://mysignins.microsoft.com/security-info`
3. Sign in → **Add sign-in method** → **Authenticator app**
4. Follow the prompts to register your new phone
5. Remove your old phone from the list once confirmed working

> **Lost or stolen device:** If your old laptop or phone was 
> lost or stolen, contact ITOps immediately. We will revoke 
> Tailscale access for that device and invalidate any active 
> sessions to protect your account and TinyCo's network.

---

## Q: Browser shows a security warning when opening Mattermost

**Symptoms:** Your browser shows "Your connection is not 
private" or a certificate warning when opening the Mattermost 
URL.

**This is expected behaviour.** The Mattermost instance uses 
a certificate issued for the Tailscale hostname. Some browsers 
flag this as untrusted because it is not a standard public 
certificate authority.

**The connection is secure** — traffic between your device 
and Mattermost is encrypted by Tailscale's WireGuard tunnel 
before it even reaches the browser.

**Steps to proceed:**

- **Chrome/Edge:** Click **Advanced** → **Proceed to 
  tinyco-vm.hair-squeaker.ts.net (unsafe)**
- **Firefox:** Click **Advanced** → **Accept the Risk 
  and Continue**
- **Safari:** Click **Show Details** → **visit this website**

---

## Q: I can connect to Tailscale but cannot see tinyco-vm

**Symptoms:** Tailscale shows Connected but `tinyco-vm` does 
not appear in your list of machines.

**Possible causes and fixes:**

1. **Your device is not approved yet** — contact ITOps to 
   approve your device

2. **The VM may be restarting** — wait 2–3 minutes and 
   refresh Tailscale

3. **You are signed into the wrong Tailscale account** — 
   sign out and sign back in with your TinyCo Microsoft 
   account specifically, not a personal Tailscale account

---

## Still Having Issues?

Contact the ITOps team with the following information to 
speed up resolution:

- Your TinyCo email address
- Your operating system and version (e.g. Windows 11, 
  macOS Ventura)
- Tailscale version — click the Tailscale icon → **About**
- Screenshot of any error messages
- Steps you have already tried from this guide

**Contact:**
- **Mattermost:** `#it-support` channel
- **Email:** `itops@TinyCoDDG.onmicrosoft.com`