# Security Policy

This is a portfolio lab, but it is built and run like production,
so security reports are welcome.

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting**
(Security tab → "Report a vulnerability") rather than a public
issue. I aim to reply within a few days.

## What is in scope

- Terraform in `01-identity/` and `02-network/`
- The agents in `03-agents/` (policy bypass, approval bypass,
  prompt injection that leads to an action, secret leakage)
- CI workflows in `.github/workflows/`

## What is never in this repo

Real API keys, webhook URLs, tenant secrets, Terraform state,
tfvars and HR data are gitignored. Hostnames, IPs and identities
in the docs are placeholders. If you find something that looks
real, please report it privately.
