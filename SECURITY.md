# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private vulnerability reporting ("Report a vulnerability" on the Security tab
of this repository). Include:

- what an attacker can do, and the preconditions (for example "a tenant with a
  valid API key can …");
- steps to reproduce, or a proof of concept;
- the commit or release you tested.

You will get an acknowledgement within 3 working days and a fix or mitigation
plan within 14 days for confirmed issues. Credit is given in the release notes
unless you prefer otherwise.

## Supported versions

Only the latest release on `main` receives security fixes.

## Threat model, in brief

| Asset | Protection |
|---|---|
| Root on the host | The agent runs as the unprivileged `ncdagent` user. Its only sudo rule is `/usr/local/sbin/ncd-certctl`, a root-owned wrapper that re-validates every argument with strict, locale-independent regexes and runs certbot/nginx with fixed flags. No shell interpolation anywhere (`execFile` with an argv). |
| Other sites on the host | No `default_server`, no catch-all, no regex `server_name`. Every vhost is written atomically, `nginx -t` is run, and a failing config is rolled back before reload. The agent only touches files with its `ncd-` prefix. |
| Platform domains | Rejected in the app (including Unicode look-alikes), in the agent and in the wrapper (which reads the list from the root-owned env file, not from the caller). |
| Domain takeover | Ownership requires a TXT record with a 160-bit random token. Certificate renewal re-checks DNS and moves the domain to `dns_lost` if it no longer routes here. |
| Cross-tenant data | Every domain query is scoped by owner. On a tenant host the proxy allows only public paths, and pages must call `checkHostOwnership()` so tenant A's domain can never render tenant B's data. Lookups of foreign resources answer 404, not 403. |
| Server IP | Tenants are only ever shown the CNAME target hostname. DNS messages never include IP addresses. |
| API keys | Stored as SHA-256 hashes; shown once at creation. Dashboard sessions use an httpOnly, SameSite=Strict cookie, and cookie-authenticated writes require a same-origin `Origin` header. |
| Abuse | Redis rate limits per tenant for verify, DNS checks and mutations; nginx `limit_req`/`limit_conn` per client on tenant hosts; Let's Encrypt staging by default. |

## Hardening checklist for operators

- Keep Redis on loopback or a private network and require a password (`requirepass`) if it is reachable by anything but the app and the agent.
- Start with `NCD_AGENT_ACME_STAGING=true`; switch to `false` once one domain reaches **Active**.
- Back up `/etc/letsencrypt`, `/etc/nginx/ncd-custom-domains` and `/etc/ncd-agent/agent.env`.
- Review `journalctl -u ncd-agent` and the `ncd:results:dead` list regularly.
