# TinyCo Entra ID — Security & Privilege Model

**Document Type:** Admin Documentation  
**Author:** Will Chang, Sr. IT Operations Engineer  
**Audience:** TinyCo IT Administrator  
**Last Updated:** April 2026  
**Repository:** https://github.com/willshchang/WSHC-Entra-IaC-Zero-Trust-Lab

---

## Overview

This document describes the security architecture and privilege model 
implemented for TinyCo's Microsoft Entra ID (formerly Azure Active 
Directory) tenant. Every decision follows the principle of least 
privilege — users and teams receive only the access they need to 
perform their role, nothing more.

For the full architectural rationale and design decisions behind 
this model, see [ARCHITECTURE.md](../ARCHITECTURE.md).

![TinyCo Security Architecture](../tinyco_security_architecture.png) 
[Showing Zero Trust two-layer model — Tailscale gates internal, Entra SSO gates SaaS]

---

## Core Security Principles

### Least Privilege
Every team receives the minimum access required to perform their 
function. No team has more access than their role requires. In the 
current lab environment, all teams are assigned access to the four 
core applications as specified in the project brief. In production, 
per-app RBAC (Role-Based Access Control) files would implement 
granular role differentiation — see 
[ARCHITECTURE.md — Per-App RBAC Design](../ARCHITECTURE.md#per-app-rbac-design).

### Group-Based Access
Permissions are assigned to groups, never to individual users:
- Adding a user to a group instantly grants correct access
- Removing a user from a group instantly revokes all associated access
- Access is auditable at the group level — one view shows who has what

### Identity as the Perimeter
TinyCo is a remote-first company. There is no corporate network 
perimeter — every resource is accessed over the internet. Identity 
verification is the primary security control. Every sign-in is 
evaluated by Conditional Access (CA) before access is granted.

### Zero Trust — Two Layers
TinyCo implements a two-layer Zero Trust model:

**Layer 1 — Network (Tailscale)**
Internal resources (Azure VM, Mattermost) are unreachable from the 
public internet. SSH port 22 is closed in the Azure Network Security 
Group (NSG). Access requires an active Tailscale VPN connection 
authenticated via Entra ID. Even an attacker with valid credentials 
cannot reach internal resources without being on the Tailscale network.

**Layer 2 — Identity (Entra ID SSO)**
Cloud SaaS applications (Tableau, Elastic) are protected by Entra 
ID SSO via SAML (Security Assertion Markup Language) or OIDC 
(OpenID Connect). MFA (Multi-Factor Authentication) is enforced 
on every sign-in via Conditional Access policy.

![TinyCo Security Architecture](../tinyco_security_architecture.png)

---

## RBAC Model

### Entra ID Directory Roles

| Team | Entra Role | What They Can Do |
|---|---|---|
| **ITOps** | Global Administrator | Full control over the entire Entra tenant — manage users, groups, apps, policies, and all settings |
| **Security** | Security Reader | Read-only access to all security settings, audit logs, and sign-in reports across the tenant |
| All others | No directory role | Standard users — can access assigned applications only |

### Azure Subscription Roles

| Team | Azure Role | What They Can Do |
|---|---|---|
| **SRE** | Contributor | Create and manage all Azure cloud resources — VMs, networking, storage. Cannot manage identity |
| **Backend** | Reader | View Azure cloud resources and infrastructure. Cannot make changes |
| All others | No subscription role | No Azure infrastructure access |

### Why These Specific Roles?

**ITOps → Global Administrator**
ITOps is responsible for the entire tenant — provisioning users, 
managing applications, configuring security policies, and responding 
to incidents. Global Administrator is the only role that provides 
the full access scope required.

**SRE → Contributor**
SRE manages TinyCo's cloud infrastructure. Contributor grants full 
resource management without the ability to modify identity or security 
settings — this separation ensures cloud operations and identity 
administration remain distinct functions.

**Security → Security Reader**
The Security team's role is to audit, not administer. Security Reader 
provides complete read-only visibility across all security settings, 
CA policies, sign-in logs, and audit trails — everything needed to 
investigate incidents without the ability to accidentally modify 
configurations.

**Backend → Reader**
Backend engineers need visibility into the Azure infrastructure their 
applications run on. Reader provides this without granting any ability 
to modify resources.

**Frontend, Design, Product, PeopleOps, Legal → No Azure Role**
These teams have no operational need to access Azure infrastructure 
or Entra administration. Standard user access to their assigned 
applications is sufficient.

---

## Application Access Model

Application access is controlled by group assignment in Entra ID. 
Only users in an assigned group can authenticate to an application 
via SSO (Single Sign-On).

### Current Lab Assignment

| Application | Access | Protocol | Provisioning |
|---|---|---|---|
| **Tailscale** | All 9 teams | OIDC | JIT via SSO |
| **Mattermost** | All 9 teams | SAML | JIT via SSO |
| **Tableau** | All 9 teams | SAML | SCIM + JIT |
| **Elastic** | All 9 teams | SAML | JIT via SSO |

> **Lab note:** All teams are assigned to all four core applications 
> per the project brief requirement. In production, a least-privilege 
> role matrix would scope access by team function. See 
> [ARCHITECTURE.md](../ARCHITECTURE.md#per-app-rbac-design) for the 
> production design.

### Stub Applications (Registered, Not Configured)

The following applications are registered in Entra as stubs — 
their existence is tracked in the codebase but SSO and provisioning 
are not yet configured:

| Application | Teams |
|---|---|
| Asana | All teams |
| Figma | Design, Frontend, Product, ITOps |
| Zoom | All teams |
| Adobe | Design, Product, PeopleOps, Legal |
| PagerDuty | ITOps, SRE, Security, Backend |
| Icinga | ITOps, SRE, Security, Backend |
| HackerOne | Security |
| ADP | PeopleOps, Legal, ITOps |
| CultureAmp | PeopleOps, ITOps |
| SurveyMonkey | Product |

---

## Conditional Access Policies

Two CA policies are enforced tenant-wide. Both were deployed via 
Terraform and are version-controlled.

### Policy 1 — Require MFA for All Users

| Setting | Value |
|---|---|
| Scope | All users, all applications, all devices |
| Action | Require MFA |
| Exclusion | Security-Exclusion-Emergency group |
| State | Enabled |

**Rationale:** MFA blocks 99.9% of account compromise attacks 
according to Microsoft's own data. At a privacy-focused company 
like TinyCo, protecting user identity is non-negotiable.

### Policy 2 — Block Legacy Authentication

| Setting | Value |
|---|---|
| Scope | All users, legacy protocol clients |
| Protocols blocked | Exchange ActiveSync, other legacy clients |
| Action | Block access entirely |
| Exclusion | Security-Exclusion-Emergency group |
| State | Enabled |

**Rationale:** Legacy authentication protocols (IMAP, SMTP, POP3, 
older Office clients) do not support MFA. Attackers actively exploit 
these protocols to bypass modern security controls. Blocking legacy 
authentication closes this attack vector entirely — recommended by 
Microsoft, CIS Benchmarks, and NIST.

### Why Security Defaults Were Disabled

Microsoft enables Security Defaults on all new tenants as a basic 
free security layer. Security Defaults and custom CA policies cannot 
coexist in the same tenant. Since TinyCo operates on an E5 licence 
with full CA capabilities, Security Defaults were disabled in favour 
of more granular, auditable custom policies.

---

## Break-Glass Account

**Account:** `admin.test@TinyCoDDG.onmicrosoft.com`  
**Role:** Global Administrator  
**Purpose:** Emergency access and lab reviewer testing  
**Password:** Delivered via submission notes

NOTE: Tailscale admin console access must be granted manually after the reviewer's first login by an existing admin or owner.
— Go to login.tailscale.com/admin/users and change the account role to Admin.

### What is a Break-Glass Account?

A break-glass account is a dedicated emergency access account that 
exists outside normal security controls. It is a standard enterprise 
practice recommended by Microsoft for every Entra tenant. Without it, 
a misconfigured CA policy could lock all administrators out of the 
tenant permanently.

### Why is it Excluded from Conditional Access?

The break-glass account is a member of the 
`Security-Exclusion-Emergency` group, which is excluded from both 
CA policies. This ensures:

- Lab reviewers can log in without MFA configured on their device
- In a real emergency where all other admin accounts are locked, 
  this account provides guaranteed access to the tenant

### Group-Based Exclusion Design

The CA policies target the `Security-Exclusion-Emergency` **group**, 
not the individual user ID. This is an intentional architectural 
decision:

> Hardcoding a specific user ID in a security policy is brittle — 
> if the account is rotated, the policy must be updated. Targeting 
> a group means emergency bypass access is granted or revoked by 
> a standard, auditable group membership operation. The security 
> policy never needs to change.

### Important Caveat — MFA Registration Prompt

> The MFA registration prompt appears on first 
> login only — this is Microsoft's one-time baseline security 
> registration. After initial setup, the Conditional Access 
> exclusion via `Security-Exclusion-Emergency` group takes full 
> effect and no MFA is required on subsequent logins. This 
> confirms the CA exclusion is working correctly.

**For lab reviewer:** When logging in with the break-glass account 
for the first time, Microsoft Authenticator setup will be prompted. 
You may skip this prompt — it does not affect your ability to 
access and inspect the tenant.

### Production Enhancement

In production, the break-glass account would additionally be 
protected by PIM (Privileged Identity Management), requiring 
justification and approval for activation with full audit logging. 
This limits the window of elevated access and creates an immutable 
record of every emergency activation.

---

## Real-World Context

This security model was designed with TinyCo's growth trajectory 
in mind. At 89 users across 9 teams today, the group-based access 
model is already structured to scale to 300+ users without 
architectural changes.

At Alberta Health Services, managing identity for 160,000 users 
across enterprise and clinical environments where least-privilege 
and audit trails were required by healthcare compliance standards 
directly informed the decisions made here:

- Group-based access over individual assignments for auditability
- Clear separation between identity administration (ITOps) and 
  cloud resource management (SRE)
- Read-only audit roles for Security to enable oversight without risk
- A break-glass account following Microsoft's own recommendations

The same principles that protect patient data at a 160,000-user 
healthcare organisation apply equally to protecting user privacy 
