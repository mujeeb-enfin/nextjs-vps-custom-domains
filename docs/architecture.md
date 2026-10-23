# Architecture

## Components

```
            ┌──────────────── Next.js app (stateless, N instances) ─────────────────┐
 browser ──►│ proxy.ts ─► pages / API routes ─► modules/custom-domains/service.ts     │
            │                                     │ repository (Prisma/Postgres)    │
            │                                     │ queue  ── LPUSH ncd:jobs ───────┼──► Redis
            │ instrumentation.ts ─► agent-results │ events ── PUBLISH ncd:events ───┼──► Redis
            │   (BLMOVE ncd:results, blocking)    └─ SSE /custom-domains/events ◄───┼─── SUBSCRIBE
            └────────────────────────────────────────────────────────────────────────┘
                                                   ▲ ncd:results         │ ncd:jobs
                                                   │                     ▼
            ┌──────────────── Linux host ─────────────────────────────────────────────┐
            │ ncd-agent (systemd, user ncdagent) ── sudo ncd-certctl ──► certbot     │
            │                                                          nginx -t/reload│
            │ certbot timer ─► renew-hook (root) ─► re-check DNS, reload, report      │
            │ nginx ── /etc/nginx/ncd-custom-domains/ncd-<host>.conf ─► 127.0.0.1:3000 │
            └──────────────────────────────────────────────────────────────────────────┘
```

- The **app** owns all state (Postgres) and every decision. It never touches the host.
- The **agent** has no database access. It turns jobs into files and certificates, and reports what happened.
- **Redis** is the only channel between them: reliable queues (`LPUSH` + `BLMOVE` into a processing list) in both directions, so neither side loses work if it crashes, and nothing polls.

## Domain lifecycle

```
           add                Verify (DNS ok)               agent ok
 (none) ───────► pending_dns ─────────────────► ssl_pending ─────────► active
                    ▲  │                        (Auto SSL on)   │ agent failed
                    │  │ Verify (Auto SSL off)                  ▼
                    │  └──────────────► verified ──agent ok──► active_external_ssl
                    │                       │ agent failed               │
                    └───────────────────────┘                ssl_failed ─┘ Retry ─► ssl_pending
                                                                  
 active / active_external_ssl ── renewal finds DNS moved ──► dns_lost ── Verify ──► …
 any state ── Remove ──► removing ── agent teardown ok ──► (row deleted)
 pending_dns (never verified) ── Remove ──► (row deleted directly, nothing on the host)
```

Every transition is a conditional `UPDATE … WHERE status IN (…)`, so concurrent
requests and late agent results cannot overwrite newer state (they get a 409 or
are logged and dropped). Every transition is written to `DomainAuditLog` and
published on `ncd:events`.

## DNS verification

`dns-verifier.ts` queries **public resolvers** (not the host's), so the result
matches what Let's Encrypt and visitors see. "Test my DNS" and "Verify" share
the same code path, so a green test means Verify passes for the same DNS state.

| Check | Blocking | Passes when |
|---|---|---|
| CNAME | yes | The hostname is a CNAME to `NCD_CNAME_TARGET`, or resolves to exactly the target's addresses (CNAME flattening at the apex). Proxied Cloudflare records get a specific "grey cloud" hint. |
| TXT | yes | `<NCD_TXT_LABEL>.<hostname>` contains `verify=<token>`. |
| AAAA | yes | No AAAA, or the same AAAA set as the target. |
| CAA | only with Auto SSL | No CAA restriction, or `letsencrypt.org` is allowed (RFC 8659 climb). |

Lookup failures are reported as `error`, never as `missing`.

## Request routing on tenant hosts

1. `proxy.ts` treats any Host that is not a platform domain, localhost or an IP literal as a tenant host, and allows only `PAGE_PATTERNS` / `API_PATTERNS` from `edge-allowlist.ts`. Everything else answers 404.
2. Pages and APIs that render tenant data call `checkHostOwnership(host, ownerId)`, which resolves the Host to its owner (Redis cache, then DB) and requires the domain to be serving.

## Agent safety

- Hostnames are validated three times: in the app, in the agent, and in `ncd-certctl`.
- Vhost changes: write to a temp file, atomic rename, `nginx -t`, then reload; on failure the previous file is restored.
- The ACME-only vhost exists only while the first certificate is being issued.
- Before issuing, the agent re-checks that the hostname routes to the CNAME target, so a misconfigured record fails fast instead of consuming Let's Encrypt rate limits.
