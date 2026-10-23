# nextjs-custom-domains

Self-hosted **custom domains for multi-tenant Next.js SaaS**. Your tenants connect
their own domain (for example `shop.theircompany.com`). Ownership is proven with
DNS, Let's Encrypt certificates are issued and renewed automatically, and each
domain gets its own nginx vhost. A small host agent does the work, with a single
audited sudo command.

No third-party SaaS, no wildcard certificates, and your server IP is never shown
to tenants. They CNAME to a hostname you control.

```
tenant DNS:   shop.theircompany.com  CNAME  domains.yourplatform.com   (DNS only)
              _yourplatform-verify.shop.theircompany.com  TXT  verify=<token>
                                   │
   Internet ─► host nginx ── /etc/nginx/ncd-custom-domains/ncd-<host>.conf ──► Next.js app (127.0.0.1:3000)
                                   ▲
   Next.js app ── LPUSH ncd:jobs ──► ncd-agent (systemd, unprivileged)
                                       └─ sudo ncd-certctl ─► certbot · nginx -t · nginx reload
   Next.js app ◄── LPUSH ncd:results ─┘  (app applies the DB transition and pushes SSE to the dashboard)
```

## What you get

| Part | Where | What it does |
|---|---|---|
| Dashboard UI | `src/app/page.tsx`, `src/features/custom-domains/` | Add a domain, copy the DNS records, **Test my DNS**, **Verify**, retry SSL, remove. Live status over Server-Sent Events, no polling. |
| REST API | `src/app/api/v1/custom-domains/` | `GET/POST /custom-domains`, `GET/PATCH/DELETE /custom-domains/{id}`, `POST …/dns-check`, `POST …/verify`, `POST …/ssl/retry`, `GET …/events` (SSE). |
| Domain service | `src/modules/custom-domains/` | Hostname validation (IDN, public suffixes, look-alike detection), DNS verification against public resolvers, state machine, audit log, Redis job queue, host-to-tenant resolver. |
| Edge guard | `src/proxy.ts` | On a tenant host only allow-listed public paths are served; the dashboard and private APIs return 404. |
| Host agent | `agent/` | Turns jobs into nginx vhosts and Let's Encrypt certificates. Every nginx change is tested and rolled back on failure; certificate renewal re-checks DNS. |

## Quick start (single Linux host)

Requirements: a Linux VM with a public IP, ports 80/443 open to the internet,
nginx, certbot, Node.js 20+ and Docker.

```bash
git clone https://github.com/<you>/nextjs-custom-domains.git && cd nextjs-custom-domains
cp .env.example .env            # fill in every value
docker compose up -d --build    # app + Postgres + Redis (loopback only)
curl -s http://127.0.0.1:3000/api/health          # {"status":"ok"}
npm ci && npm run owner:create -- "Acme Store"   # prints an API key once (uses DATABASE_URL from .env)
sudo ./agent/install.sh         # first run writes /etc/ncd-agent/agent.env; fill it, run again
```

Then, once, in **your platform's** DNS zone, create the routing record tenants
will CNAME to: `domains.yourplatform.com A <your server IPv4>` (and `AAAA` if
you have IPv6). On Cloudflare set it to **DNS only**.

Point your platform hostname (for example `app.yourplatform.com`) at the same
server, add an nginx server block for it that proxies to `127.0.0.1:3000`, open
the dashboard and sign in with the API key.

Full guide, including AWS, Azure and GCP: **[docs/deployment.md](docs/deployment.md)**.

## Where it runs

The agent needs a host it controls: nginx, systemd, sudo, ports 80/443 and a
persistent `/etc/letsencrypt`.

| Platform | Works? | Notes |
|---|---|---|
| Any VPS (Hetzner, DigitalOcean, Linode, OVH, Contabo…) | **Yes, as-is** | The reference setup. |
| AWS EC2 / Lightsail | **Yes, as-is** | Elastic IP, security group open on 80/443. |
| Azure Virtual Machines | **Yes, as-is** | Public IP, NSG open on 80/443. |
| Google Compute Engine | **Yes, as-is** | Static external IP, firewall rule for 80/443. |
| Several VMs behind a **TCP / Network** load balancer (AWS NLB, Azure LB, GCP passthrough NLB) | **Yes, with care** | TLS must pass through to nginx. Run the agent on every node, share `/etc/letsencrypt` and the vhost dir, or use one ingress node. See the guide. |
| Behind an HTTP load balancer that terminates TLS (AWS ALB, Azure App Gateway, GCP HTTPS LB) | **Partly** | Let's Encrypt via the agent does not fit; turn Auto SSL off and manage certificates at the load balancer (e.g. ACM), or use the alternatives below. |
| Kubernetes / ECS on EC2 | **Adapt** | Replace the agent's nginx/certbot steps with an Ingress + cert-manager controller, or run the agent as a DaemonSet on ingress nodes. The app, API and UI work unchanged. |
| AWS Fargate, Azure Container Apps, Cloud Run, Vercel, Netlify | **App: yes. Agent: no.** | No host nginx, systemd or sudo. Keep the app (DNS verification, UI and API work) and swap the agent for Cloudflare for SaaS, Caddy on-demand TLS or the platform's own custom-domain API. See [docs/deployment.md](docs/deployment.md#serverless-and-managed-containers). |

## Configuration

App (`.env`, every value required, no silent defaults):

| Variable | Example | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgresql://…` | Postgres. |
| `REDIS_URL` | `redis://localhost:6379` | Job queue, results queue, pub/sub, caches, rate limits. |
| `NCD_PLATFORM_NAME` | `Example` | Shown in tenant-facing copy. |
| `NCD_PLATFORM_DOMAINS` | `example.com` | Your own domains. Never claimable; the dashboard only runs on these. |
| `NCD_CNAME_TARGET` | `domains.example.com` | What tenants CNAME to. A hostname, never an IP. |
| `NCD_RESOLVERS` | `1.1.1.1,8.8.8.8` | Public resolvers for verification. |
| `NCD_TXT_LABEL` | `_example-verify` | Ownership record label. |
| `NCD_ERROR_LOG_FILE` | `logs/errors.log` | Optional. ERROR records are also appended here. |

Agent (`/etc/ncd-agent/agent.env`): see [`agent/agent.env.template`](agent/agent.env.template).

## Development

```bash
npm ci
cp .env.example .env               # local Postgres + Redis
npm run db:deploy                  # apply migrations
npm run dev
npm test                           # unit tests (DNS tests query real public DNS)
npm run test:e2e:headed            # Playwright against a running app
npm run lint && npm run typecheck && npm run build
```

## Integrating into your own app

The code is written to be lifted out. Copy `src/modules/custom-domains/`,
`src/app/api/v1/custom-domains/`, `src/features/custom-domains/`, `src/proxy.ts`,
`src/instrumentation.ts` and `agent/`, then:

1. Replace `src/lib/auth.ts` with your own auth. The module only needs an `Actor` (`ownerId`, `actor`, `ipAddress`).
2. Rename `Owner` in `prisma/schema.prisma` to your tenant model, or relate `CustomDomain.ownerId` to it.
3. Add your public tenant pages to `PAGE_PATTERNS` in `edge-allowlist.ts`, and call `checkHostOwnership()` in each.

## Security

The agent's only privilege is `sudo /usr/local/sbin/ncd-certctl`, a root-owned
wrapper that validates every argument. Hostnames are validated in the app, the
agent and the wrapper. Platform domains can never be claimed. See
[SECURITY.md](SECURITY.md) and [docs/architecture.md](docs/architecture.md).

## License

[MIT](LICENSE)
