# Deployment guide

The project has two parts with different hosting needs:

| Part | Needs |
|---|---|
| **App** (Next.js UI + API + domain service) | Node.js 20+ (or the Docker image), Postgres, Redis. Runs anywhere Next.js runs. |
| **Host agent** (`agent/`) | A Linux host you control: **nginx**, **certbot**, **systemd**, **sudo**, **ports 80 and 443 reachable from the whole internet**, and a **persistent `/etc/letsencrypt`**. It must run on the machine whose nginx receives tenant traffic. |

The agent is what makes this self-hosted: it writes one nginx vhost and one
Let's Encrypt certificate per tenant domain. Where you cannot run it, keep the
app and replace only the agent (see [the last section](#serverless-and-managed-containers)).

---

## 1. Single VM: VPS, AWS EC2, Azure VM, Google Compute Engine

This is the reference setup and works unchanged on any provider.

### 1.1 Prepare the VM

- Ubuntu 22.04/24.04 or Debian 12 (RHEL-family works; install `nginx`, `certbot` and `acl` with `dnf`).
- A static public IPv4 (AWS **Elastic IP**, Azure **Static public IP**, GCP **reserved external IP**).
- Inbound **TCP 80 and 443 from 0.0.0.0/0** (and `::/0` for IPv6):
  - AWS: security group inbound rules.
  - Azure: network security group rules on the NIC or subnet.
  - GCP: VPC firewall rule targeting the instance's network tag.
  - Host firewall: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`.
  If ports 80/443 are restricted to a CDN's ranges (common with Cloudflare-only setups),
  tenant domains and Let's Encrypt cannot reach the host. Open them.

```bash
sudo apt update && sudo apt install -y nginx certbot acl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
curl -fsSL https://get.docker.com | sudo sh
```

### 1.2 Platform DNS (once)

In your own DNS zone:

| Record | Value | Notes |
|---|---|---|
| `app.example.com  A` | server IPv4 | Your dashboard / platform host. |
| `domains.example.com  A` (+ `AAAA`) | server IPv4 (+ IPv6) | **The CNAME target.** Must be **DNS only** if your zone is on Cloudflare: a proxied record makes Let's Encrypt HTTP-01 and TLS for tenant domains fail. |

Tenants only ever see `domains.example.com`; the IP stays out of the product.
If the server changes, update this one record and every tenant follows.

### 1.3 Run the app

```bash
git clone https://github.com/<you>/nextjs-custom-domains.git /opt/nextjs-custom-domains
cd /opt/nextjs-custom-domains
cp .env.example .env && chmod 600 .env   # set NCD_*, POSTGRES_* and a strong POSTGRES_PASSWORD
docker compose up -d --build
curl -s http://127.0.0.1:3000/api/health
```

The app, Postgres and Redis publish ports on **127.0.0.1 only**. nginx is the
only public entry point.

Platform host vhost (`/etc/nginx/conf.d/app.example.com.conf`), issued with
`sudo certbot --nginx -d app.example.com` afterwards:

```nginx
server {
    listen 80;
    server_name app.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;          # Server-Sent Events
        proxy_read_timeout 1h;        # long-lived SSE stream
    }
}
```

Create the first tenant (prints its API key once):

```bash
npm ci && npm run owner:create -- "Acme Store" 10
```

### 1.4 Install the agent

```bash
sudo ./agent/install.sh        # first run creates /etc/ncd-agent/agent.env and stops
sudo nano /etc/ncd-agent/agent.env
sudo ./agent/install.sh        # builds, installs, validates nginx, starts ncd-agent
journalctl -u ncd-agent -f
```

Keep `NCD_AGENT_ACME_STAGING=true` until a test domain reaches **Active**, then
set it to `false` and re-run the installer. The installer is idempotent; re-run it
after every upgrade.

### 1.5 Verify end to end

1. Sign in at `https://app.example.com` with the API key.
2. Add `shop.yourtestdomain.com`, create the CNAME and TXT records it shows.
3. **Test my DNS** turns green, then **Verify**. Status moves *Issuing certificate* to *Active* live.
4. `curl -I https://shop.yourtestdomain.com` returns 200 with a Let's Encrypt certificate;
   `curl -I https://shop.yourtestdomain.com/api/v1/custom-domains` returns 404 (private API blocked on tenant hosts).

### Shared hosts and control panels

The agent coexists with other sites: it never installs a `default_server` or
catch-all, and every change passes `nginx -t` or is rolled back. The installer
detects whether nginx loads `conf.d/*.conf` or `sites-enabled/*` (some panels
only load the latter) and, if `/etc/nginx` is mode 0700, grants the agent user
traverse-only access with an ACL.

---

## 2. Several VMs behind a load balancer

Use a **layer-4 (TCP) load balancer that passes TLS through**: AWS **Network Load
Balancer** (TCP listeners on 80 and 443), Azure **Load Balancer**, GCP **passthrough
Network Load Balancer**. Point `domains.example.com` at the load balancer (AWS: a
Route 53 alias, or the NLB's static Elastic IPs).

Every node must be able to serve every certificate and answer every HTTP-01
challenge. Pick one:

- **One ingress node** (simplest): only one node runs nginx + the agent; the app scales behind it on a private network (`NCD_AGENT_UPSTREAM` stays loopback, so put a local nginx/HAProxy upstream or run one app replica there).
- **Shared state**: mount `/etc/letsencrypt`, `/etc/nginx/ncd-custom-domains` and `/var/www/ncd-acme` on all nodes from shared storage (EFS, Azure Files, Filestore), run the agent on exactly **one** node, and reload nginx on the others when files change (for example with a `systemd.path` unit).

Redis and Postgres must be shared by all app instances (ElastiCache / Azure Cache
for Redis / Memorystore; RDS / Azure Database for PostgreSQL / Cloud SQL). The
status stream already fans out across instances through Redis pub/sub.

**HTTP load balancers that terminate TLS** (AWS ALB, Azure Application Gateway,
GCP HTTPS LB) are a different model: the certificate must live on the load
balancer, so the agent's Let's Encrypt flow does not apply. Either issue
certificates there (AWS ACM + ALB SNI certificate list, up to the ALB's
certificate limit) and add tenants with **Auto SSL off**, or use one of the
alternatives in section 4.

---

## 3. Kubernetes and ECS on EC2

The app, API, UI and DNS verification run unchanged as a Deployment/Service.
For the agent, choose one:

- Replace `agent/` with a small controller that, for each `provision` job, creates an
  `Ingress` (or Gateway API `HTTPRoute`) for the hostname and a cert-manager
  `Certificate` (HTTP-01), and reports the result on `ncd:results` in the same JSON
  shape (see `AgentResult` in `src/modules/custom-domains/types.ts`).
- Or run the agent as a DaemonSet on dedicated ingress nodes with host networking
  and host nginx. This is workable but operationally heavier.

---

## 4. Serverless and managed containers

**AWS Fargate, Azure Container Apps, Google Cloud Run, App Runner, Vercel, Netlify**:
the app runs fine (use `Dockerfile`, managed Postgres and managed Redis), but the
agent cannot. There is no host nginx, systemd or sudo, and no persistent
`/etc/letsencrypt`.

Keep everything in `src/` and replace only the agent with a component that
consumes `ncd:jobs` and publishes `ncd:results`:

| Option | How it maps |
|---|---|
| **Cloudflare for SaaS** (Custom Hostnames) | `provision` calls the Custom Hostnames API; Cloudflare issues the certificate and routes to your origin. Tenants CNAME to your Cloudflare fallback origin. |
| **Caddy with on-demand TLS** | Run Caddy on a small VM or container with a volume; its `ask` endpoint calls your app to confirm the hostname is `verified`. |
| **Vercel / Netlify domains API** | `provision` adds the domain to the project through their API; the platform issues the certificate. |
| **AWS ALB + ACM** | `provision` requests an ACM certificate (DNS or HTTP validation) and attaches it to the ALB listener. Watch the per-ALB certificate limit. |

---

## Operations

| Task | Command |
|---|---|
| Agent logs | `journalctl -u ncd-agent -f`, `/var/log/ncd-agent/agent.log` |
| Pending jobs | `redis-cli LRANGE ncd:jobs 0 -1` |
| In-flight job | `redis-cli LRANGE ncd:processing 0 -1` (re-queued automatically when the agent restarts) |
| Results not yet applied | `redis-cli LRANGE ncd:results 0 -1` |
| Results that failed 5 times | `redis-cli LRANGE ncd:results:dead 0 -1`. Inspect, fix, then `LMOVE` back to `ncd:results`. |
| Certificates | `sudo certbot certificates --cert-name ncd-<hostname>` |
| Renewal dry run | `sudo certbot renew --dry-run` |
| Upgrade | `git pull && docker compose up -d --build && sudo ./agent/install.sh` |

Renewal uses certbot's own systemd timer. Its deploy hook re-checks DNS (and
reports **DNS changed** if the tenant moved away), reloads nginx and reports
the new expiry to the app.

**Backups:** Postgres, `/etc/letsencrypt`, `/etc/nginx/ncd-custom-domains`,
`/etc/ncd-agent/agent.env`.

## Troubleshooting

- **Stuck on "Issuing certificate"**: the agent is stopped or cannot reach Redis. Check `systemctl status ncd-agent` and `ncd:jobs`.
- **"Certificate failed"**: the tenant sees certbot's real error. Usual causes: the record is proxied through a CDN, CAA forbids Let's Encrypt, a stray AAAA record, or port 80 is firewalled. The tenant fixes DNS and clicks **Retry certificate**.
- **Browser shows `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`**: `domains.example.com` itself is proxied by Cloudflare. Set it to DNS only.
- **`nginx -t` failed**: the agent restored the previous config and reported the error. Nothing else on the host changed.
- **`sudo: … no new privileges`**: a systemd drop-in added sandboxing to `ncd-agent.service`. Remove it; see the unit file's comment.
