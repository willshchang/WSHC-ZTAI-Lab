# TinyCo — Employee Getting Started Guide

**Document Type:** User Documentation  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** All TinyCo Employees  
**Last Updated:** April 2026

---

## Welcome to TinyCo

This guide helps you get connected to TinyCo's tools on your 
first day. Your IT team has already created your account — 
you just need to activate it and connect to your apps.

**What you need:**
- Your TinyCo email: `firstname.lastname@TinyCoDDG.onmicrosoft.com`
- Your temporary password (provided by ITOps via secure channel)
- A smartphone for MFA (Multi-Factor Authentication) setup

**Your apps:**

| App | Purpose | Access |
|---|---|---|
| Tailscale | Secure VPN — required for internal tools | tailscale.com |
| Mattermost | Team chat | Via Tailscale only |
| Tableau | Data & analytics | sso.online.tableau.com |
| Elastic | Observability & logs | Via Elastic Cloud URL |

---

## Step 1 — Sign In and Set Up MFA

MFA (Multi-Factor Authentication) is required for all TinyCo 
accounts. You will be prompted to set it up on first login.

**What you need:** Microsoft Authenticator app on your smartphone.

1. Download **Microsoft Authenticator**
   - iOS: App Store → search **Microsoft Authenticator**
   - Android: Play Store → search **Microsoft Authenticator**

2. Open your browser and go to:
https://myaccount.microsoft.com

3. Sign in with your TinyCo email and temporary password

4. When prompted, click **Next** to set up Microsoft Authenticator

5. Open Microsoft Authenticator on your phone → tap **+** → 
   **Work or school account** → **Scan QR code**

6. Scan the QR code shown on screen

7. Approve the test notification on your phone

8. Change your password when prompted — choose something strong 
   and unique

> **Why MFA?** TinyCo is a remote-first company. Your identity 
> is the security perimeter — MFA blocks 99.9% of account 
> compromise attacks. It takes 5 seconds per login and protects 
> both you and TinyCo.

---

## Step 2 — Connect to Tailscale VPN

Tailscale is TinyCo's zero-trust network. You must be connected 
to Tailscale to access internal tools like Mattermost.

### Install Tailscale

Download for your device:

| Platform | Download |
|---|---|
| Windows | https://tailscale.com/download/windows |
| macOS | https://tailscale.com/download/mac |
| iOS | App Store → search **Tailscale** |
| Android | Play Store → search **Tailscale** |
| Linux | https://tailscale.com/download/linux |

### Connect to TinyCo Network

1. Open Tailscale after installing
2. Click **Log in**
3. Select **Sign in with Microsoft**
4. Sign in with your TinyCo email 
   (`firstname.lastname@TinyCoDDG.onmicrosoft.com`)
5. Approve the MFA prompt on your phone
6. You are now connected to TinyCo's private network

status with tinyco-vm visible]

> **Keep Tailscale running** whenever you need access to internal 
> TinyCo resources. It runs quietly in the background and does 
> not affect your regular internet browsing.

---

## Step 3 — Access Mattermost (Team Chat)

Mattermost is TinyCo's internal communication platform — 
equivalent to Slack.

> ⚠️ **Tailscale must be connected** before accessing Mattermost.

1. Ensure Tailscale shows **Connected** in your system tray
2. Open your browser and go to:
https://tinyco-vm.hair-squeaker.ts.net/tinycoddg
3. Click **Sign in with Entra ID**
4. Sign in with your TinyCo email
5. Approve the MFA prompt on your phone
6. You will land in **Town Square** — TinyCo's main channel

> **Browser security warning:** Your browser may show a 
> certificate warning when opening Mattermost. This is expected — 
> click **Advanced** → **Proceed** to continue. The connection 
> is secured by Tailscale's encrypted tunnel.

---

## Step 4 — Access Tableau (Data & Analytics)

Tableau is TinyCo's business intelligence platform for data 
visualisation and reporting.

1. Open your browser and go to:
https://sso.online.tableau.com/public/idp/SSO
2. Sign in with your TinyCo email
3. Approve the MFA prompt on your phone
4. You will land on your Tableau Cloud home page

> **Tailscale not required** for Tableau — it is a public 
> cloud service accessible from any internet connection.

---

## Step 5 — Access Elastic (Observability & Logs)

Elastic is TinyCo's platform for infrastructure monitoring 
and log analysis. Access is provided to relevant teams only.

1. Go to https://tinyco-prod-cluster-3acb9f.kb.westus2.azure.elastic-cloud.com/
2. Click **Kibana Sign in with Entra ID SSO**
3. Sign in with your TinyCo email
4. Approve the MFA prompt on your phone

> **Tailscale not required** for Elastic — it is a public 
> cloud service.

---

## Your TinyCo Identity at a Glance

| Item | Value |
|---|---|
| Email | `firstname.lastname@TinyCoDDG.onmicrosoft.com` |
| MFA method | Microsoft Authenticator (required) |
| Password reset | https://aka.ms/sspr |
| Account portal | https://myaccount.microsoft.com |
| All your apps | https://myapps.microsoft.com |

> **MyApps portal** — bookmark `https://myapps.microsoft.com`. 
> This shows all your TinyCo applications in one place and 
> provides a quick-launch link for each one.

---

## Need Help?

Contact the ITOps team:

- **Mattermost:** `#it-support` channel
- **Email:** `itops@TinyCoDDG.onmicrosoft.com`

When contacting ITOps, please include:
- Your TinyCo email address
- The app you are trying to access
- A screenshot of any error message
- Steps you have already tried