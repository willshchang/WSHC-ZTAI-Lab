# Threat Model

**Document Type:** Security Reference  
**Author:** Will Chang, Zero Trust AI Engineer  
**Audience:** Security, identity and platform engineers  
**Last Updated:** October 2026  
**Repository:** https://github.com/willshchang/WSHC-ZTAI-Lab  

---

## How to read this

Every row is one threat: where it can hit, the control that answers it,
and **how you can check the control yourself**: a test you can run, a
file you can read, or a deny rule that runs on every `terraform plan`.

The status is deliberately plain:

| Status | Meaning |
|---|---|
| **Built** | In code, and a test or policy check fails if it breaks |
| **Partial** | Mostly in code, with a stated gap |
| **Manual** | Needs a human step outside code (documented) |
| **Gap** | Known and not solved yet. Listed so nobody assumes it is |

Agent risks are mapped to the
[OWASP Top 10 for LLM Applications (2025)](https://genai.owasp.org/initiatives/top-10-for-llm-and-genai/)
(`LLM01` to `LLM10`) and the
[OWASP Top 10 for Agentic Applications](https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/)
(`ASI01` to `ASI10`). Every agent control listed as Built was also broken
on purpose in a mutation sweep (39 breaks, then 7 more after an
independent review), and a test caught each one.

The trust boundaries are drawn in the
[security model diagram](../README.md#security-model).

---

## What we protect

| Asset | Why it matters |
|---|---|
| Tenant identities (Entra ID) | Accounts, groups and roles decide what every person can open |
| Privileged access | Global Administrator and the break-glass account can change everything |
| Tailnet devices and the home LAN | The VM is internet-facing; the LAN holds personal devices |
| Customer and HR data | Signups and HR events pass through the agents |
| Agent credentials | One API key per agent, Graph app credentials, Slack webhooks |
| Human attention | An approval prompt is only a control if the human sees the truth |

---

## Layer 3: AI agents

| # | Threat | OWASP | Where | Control | Status | Check it |
|---|---|---|---|---|---|---|
| A1 | **Prompt injection** through data: a signup note tells the agent to export all contacts | LLM01, ASI01 | GTM and JML inputs | The model is only offered its own tools, and any other tool call is refused at runtime (`policy_denied`). External writes need a human. What posts is the code-built draft, not model text | Built | `npm run test:policy`, `test:gtm`, [sample trace 1](../03-agents/examples/sample-traces/) |
| A2 | **Excessive agency / tool misuse**: an agent uses a tool beyond its job | LLM06, ASI02 | Every agent | Per-agent allowlist enforced twice (what is offered, what may run). Risk tiers: read, internal-write, external-write. Tool input is schema-checked (types, enums, no extra fields, length caps) before any approval | Built | `test:policy`, `test:engine` |
| A3 | **Confused deputy**: a worker sent for one record acts on another (`hr-1001` task, `hr-1009` action) | ASI03 | Scarlet to worker | Each worker run is bound to the id in its task. Any other id is refused and traced (`reason: id_binding`) | Built | `test:jml`, `test:gtm` |
| A4 | **Non-human identity abuse**: agents share one key, or a key is redirected | ASI03 | Model API client | One API key per agent, no fallback to a shared key. The client ignores `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, so a stray environment variable can't redirect a key or add a shared credential | Built | `test:engine` |
| A5 | **Privilege abuse in the tenant**: the JML agent disables an admin or break-glass account | ASI03 | JML to Microsoft Graph | Five Graph permissions, no delete. Protected groups are checked through nested membership (`transitiveMembers`). An empty or malformed protected list stops the agent (fail closed). Leavers are disabled, never deleted | Built | `test:jml`, `test:graph`, [sample trace 3](../03-agents/examples/sample-traces/) |
| A6 | **Approval spoofing**: hidden characters make the human approve something other than what runs (Trojan Source, `\r`, ESC, bidi overrides) | ASI09, LLM05 | Approval prompt | Control and invisible characters are shown as visible escapes. External writes containing them are refused before anyone is asked. The trace records a SHA-256 of the exact text shown, and only those bytes are posted. One "no" denies the rest of the run | Built | `test:engine` |
| A7 | **Approval fatigue**: `y` typed ahead, or a prompt under a scripted terminal | ASI09 | Approval prompt | Default deny with no terminal. Pending keystrokes are discarded before each prompt. Approval is still `y/N`, not a typed token | Partial | `test:engine` |
| A8 | **Improper output handling** into Slack: `<!channel>` or a disguised link in customer data | LLM05 | Slack posts and friction reports | `&`, `<`, `>` escaped per Slack's rules, lengths capped, emoji never split | Built | `test:engine`, `test:gtm` |
| A9 | **Insecure inter-agent communication**: Scarlet hands work to the wrong agent, or a worker's reply steers her | ASI07 | Delegation | Contracts in `agents.json`: anchored task patterns, an enum of known agents, and a runtime allowlist. Scarlet holds no data tools. Worker replies are passed on as text; quoting them is a prompt rule only | Partial | `test:contract` |
| A10 | **Memory and context poisoning** | ASI06 | Scarlet session memory | Memory is per session, text only, never on disk, wiped after 30 minutes idle. Gap: it stores Scarlet's reply, which can quote worker or customer text | Partial | `03-agents/scarlet/index.ts` |
| A11 | **Silent failure and cascading errors**: a crash or a skipped step reported as done | ASI08 | Engine, delegation | Any error ends the run with `run_error`, a system alert and `run_end`, even if Slack is down. A handoff whose worker errored, hit its limit or did nothing fails. Gap: a worker whose write the human denied still counts as completed | Partial | `test:engine`, `test:act-first` |
| A12 | **Small talk swallows a request**: the chat tool answers "Leo is leaving, disable him" with a friendly reply | ASI01 | Scarlet `chat` tool | `chat` refuses any message matching an agent's request words (word stems, `hr 1003` forms). Still a word list: an unusual phrasing can pass | Partial | `test:chat` |
| A13 | **Truncated or refused model output runs a half-formed action** | LLM05 | Engine | A tool call cut off by the token or context limit never runs; one retry, then the run fails. A refusal runs nothing. An empty reply is never sent back | Built | `test:engine` |
| A14 | **Unbounded consumption / runaway agent** | LLM10, ASI10 | Engine | Step limit per run, token limits, timeouts on every network call (15 s for Slack and Graph, 60 s for the model), bounded retries that honour `Retry-After`. Spend cap per key is set in the provider console | Built, cap Manual | `test:engine` |
| A15 | **Sensitive information in logs** | LLM02 | Traces | No secrets or webhook URLs in traces or errors. Trace files 0600, folder 0700. Hidden characters stored as escapes, so grepping a trace can't be spoofed. Real traces are gitignored. Redaction before central storage is planned with OpenTelemetry | Built, redaction Gap | `test:engine`, [trace README](../03-agents/examples/sample-traces/README.md) |
| A16 | **Supply chain** | LLM03, ASI04 | Dependencies and CI | One runtime dependency, lockfile, `npm audit` clean. Actions pinned to commit SHAs, `contents: read`, no credentials left after checkout. Dependabot weekly | Built | `.github/` |
| A17 | **Unexpected code execution** | ASI05 | Agents | No agent has a shell, file-write or eval tool. Nothing the model says is executed as code | Built by design | Tool lists in each `policy.ts` |

---

## Layer 1: Identity (Entra ID)

| # | Threat | Where | Control | Status | Check it |
|---|---|---|---|---|---|
| I1 | **Break-glass takeover** with a shared or known password | `users.tf` | Own password (16+ characters, must differ from the employee one), no department, permanent Global Administrator assigned directly, `prevent_destroy`. FIDO2 passkey and a sign-in alert are set up by hand | Built, FIDO2 and alert Manual | [02-security-model.md](../01-identity/docs/admin/02-security-model.md) |
| I2 | **MFA bypass** through legacy protocols | `conditional-access.tf` | Conditional Access requires MFA and blocks legacy auth | Built in code. On today's Free tenant the policies are frozen (P1 needed to change them) | [Licensing](../01-identity/README.md#licensing-what-needs-entra-id-p1) |
| I3 | **Anyone in the tenant gets an SSO token** for an app | App service principals | `app_role_assignment_required = true`: only assigned users get a token | Built (on Free, assign users directly) | Each app `.tf` |
| I4 | **Mass deprovisioning** from a bad HR file | ETL script, `users.tf` | The ETL script takes explicit files and validates headers, teams and names. A roster guard fails the plan if the CSV shrinks below a set size. `terraform plan` is reviewed before apply | Built | `01-identity/scripts/00-hr-data-etl.sh` |
| I5 | **Wrong role from a GUID typo** (Helpdesk Administrator instead of Security Reader) | `entra_role_map` | Reference values corrected and validated; ITOps must be present | Built | [01-setup-guide.md](../01-identity/docs/admin/01-setup-guide.md) |
| I6 | **Escalation through the MFA exclusion group**: an identity with group write access adds an account to it | `Security-Exclusion-Emergency` | Gap: the group is not role-assignable, so `GroupMember.ReadWrite.All` (held by the JML agent) could change it. The agent's own code refuses, but the platform doesn't. Fix needs P1 | Gap | `groups.tf` |
| I7 | **Access through an attribute**: whoever can edit `department` moves a user into a group with Azure roles | Dynamic groups and `rbac.tf` | Gap: Azure RBAC is granted to dynamic groups. Production fix: static groups for any privileged role | Gap | `rbac.tf` |
| I8 | **Too many standing admins** | ITOps role mapping | Gap: every ITOps member holds Global Administrator. Production fix: named admins, least-privilege roles, PIM | Gap | `groups.tf` |
| I9 | **Secrets in Terraform state** | Both layers | Gap: state is local. Production fix: an encrypted remote backend with Entra auth | Gap | `providers.tf` |

---

## Layer 2: Network (Tailscale)

| # | Threat | Where | Control | Status | Check it |
|---|---|---|---|---|---|
| N1 | **Lateral movement** from the internet-facing VM to the home LAN | `acl.tf` | Default deny. The VM has no grant to the home subnet, and deny tests prove it on every plan | Built | `tests` block in `acl.tf` |
| N2 | **Privileged SSH** with a stolen session | `acl.tf` | Tailscale SSH only, port 22 closed. Named non-root users by `accept`; `root` only through a `check` rule that asks for a fresh browser sign-in | Built | `sshTests` in `acl.tf` |
| N3 | **Auth key leakage** | `keys.tf` | Keys are single-use, tagged, expire in an hour, marked sensitive, and handed to `tailscale up` through a file, never on the command line | Built | [08-keys.md](../02-network/docs/iac/08-keys.md) |
| N4 | **Policy drift**: someone edits the ACL in the admin console | Tailnet settings | Gap: the console is not locked to Terraform (`acls_externally_managed_on` not set) | Gap | `tailnet_settings.tf` |
| N5 | **Network identity outside Entra**: the tailnet admin signs in with a personal identity provider, so Entra MFA does not gate it | Tailnet login | Gap: moving the tailnet to Entra ID (with SCIM groups in the ACL) is planned | Gap | [02-network README](../02-network/README.md) |

---

## Terms used here

| Term | Meaning in this lab |
|---|---|
| **Non-human identity (NHI)** | An identity used by software, not a person: each agent's API key, the Graph app, the Terraform OAuth client. Each one is scoped to one job and has a named human owner |
| **Excessive agency** | An agent able to do more than its task needs. The answer is least agency: only the tools, permissions and autonomy the job requires |
| **Confused deputy** | A trusted component tricked into using its access for someone else's goal. Binding each worker to its task id stops it |
| **Trojan Source** | Hidden Unicode characters that make text look different from what it is. Escaped everywhere a human reads agent output |
| **Blast radius** | What one compromised piece can reach. One key per agent and default-deny ACLs keep it to one job and one port |
| **Policy as code** | Access rules written, reviewed and tested like code: `acl.tf`, the agent policies, the Conditional Access policies |
| **Workload identity federation** | Software proving who it is with a short-lived token from its platform instead of a stored secret. The planned next step for agent keys |
| **Agent observability** | Following every agent run end to end: trigger, decisions, identity used, actions, outcome. Today JSONL traces; planned OpenTelemetry |

---

## Official References

| Topic | URL |
|---|---|
| OWASP Top 10 for LLM Applications (2025) | https://genai.owasp.org/initiatives/top-10-for-llm-and-genai/ |
| OWASP LLM01 Prompt Injection | https://genai.owasp.org/llmrisk/llm01-prompt-injection/ |
| OWASP LLM06 Excessive Agency | https://owasp.org/www-project-top-10-for-large-language-model-applications/2_0_vulns/LLM06_ExcessiveAgency.html |
| OWASP Top 10 for Agentic Applications | https://genai.owasp.org/2025/12/09/owasp-top-10-for-agentic-applications-the-benchmark-for-agentic-security-in-the-age-of-autonomous-ai/ |
| NIST SP 800-207 Zero Trust Architecture | https://csrc.nist.gov/pubs/sp/800/207/final |
| Microsoft: emergency access accounts | https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/security-emergency-access |
| Microsoft: role-assignable groups | https://learn.microsoft.com/en-us/entra/identity/role-based-access-control/groups-concept |
| Microsoft Graph: list transitive members | https://learn.microsoft.com/en-us/graph/api/group-list-transitivemembers |
| Tailscale policy file syntax (tests, SSH check) | https://tailscale.com/docs/reference/syntax/policy-file |
| Slack: formatting and escaping text | https://docs.slack.dev/messaging/formatting-message-text |
| Anthropic: handling stop reasons | https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons |
| GitHub Actions secure use | https://docs.github.com/en/actions/reference/security/secure-use |
