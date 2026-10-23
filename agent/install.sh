#!/usr/bin/env bash
# ------------------------------------------------------------------------------
# Installs / updates the nextjs-custom-domains host agent. Idempotent: safe to
# re-run after every deploy.
#
#   sudo ./agent/install.sh
#
# Touches only these paths:
#   /opt/ncd-agent, /etc/ncd-agent, /etc/nginx/ncd-custom-domains,
#   /etc/nginx/{conf.d|sites-enabled}/ncd-custom-domains.conf, /var/www/ncd-acme,
#   /var/log/ncd-agent, /etc/sudoers.d/ncd-agent, /usr/local/sbin/ncd-certctl,
#   /etc/systemd/system/ncd-agent.service
# ------------------------------------------------------------------------------
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX=/opt/ncd-agent
ENV_FILE=/etc/ncd-agent/agent.env
log() { printf '[ncd-agent install] %s\n' "$*"; }
die() { printf '[ncd-agent install] ERROR: %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "run as root (sudo)"
command -v nginx   >/dev/null || die "nginx is not installed"
command -v certbot >/dev/null || die "certbot is not installed (e.g. apt install certbot)"
command -v node    >/dev/null || die "node (>=20) is not installed"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || die "node >= 20 required"
WEB_GROUP=$(getent group www-data >/dev/null && echo www-data || echo nginx)

log "user + directories"
id -u ncdagent >/dev/null 2>&1 || useradd --system --home "$PREFIX" --shell /usr/sbin/nologin ncdagent
install -d -o root     -g root        -m 0755 "$PREFIX" "$PREFIX/bin" "$PREFIX/templates" /etc/ncd-agent
install -d -o ncdagent -g ncdagent    -m 0755 /etc/nginx/ncd-custom-domains /var/log/ncd-agent
install -d -o ncdagent -g "$WEB_GROUP" -m 0755 /var/www/ncd-acme

log "environment"
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 -o root -g root "$SRC/agent.env.template" "$ENV_FILE"
  die "created $ENV_FILE from the template: fill in every value, then re-run"
fi
# systemd reads the file as root; the agent process itself never reads it.
chmod 0600 "$ENV_FILE"
for key in NCD_AGENT_REDIS_URL NCD_AGENT_UPSTREAM NCD_AGENT_CNAME_TARGET NCD_AGENT_PLATFORM_DOMAINS NCD_AGENT_RESOLVERS NCD_AGENT_ACME_EMAIL NCD_AGENT_ACME_STAGING; do
  grep -Eq "^${key}=.+" "$ENV_FILE" || die "${key} is empty in $ENV_FILE"
done
grep -q '^NCD_AGENT_CNAME_TARGET=domains.example.com$' "$ENV_FILE" && die "NCD_AGENT_CNAME_TARGET is still the example value"

log "build agent"
( cd "$SRC" && npm ci --no-audit --no-fund && npm run build )
rm -rf "$PREFIX/dist" "$PREFIX/node_modules"
cp -r "$SRC/dist" "$SRC/node_modules" "$SRC/package.json" "$PREFIX/"
install -m 0644 "$SRC"/templates/*.tmpl "$PREFIX/templates/"

# certbot runs the deploy hook as root; the hook loads the agent env itself.
cat > "$PREFIX/bin/renew-hook" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
set -a; . /etc/ncd-agent/agent.env; set +a
exec /usr/bin/node /opt/ncd-agent/dist/renew-hook.js
HOOK
chmod 0755 "$PREFIX/bin/renew-hook"

log "privileged wrapper (root-owned; the agent's only sudo command)"
install -m 0755 -o root -g root "$SRC/bin/ncd-certctl" /usr/local/sbin/ncd-certctl

log "sudoers"
install -m 0440 -o root -g root "$SRC/sudoers/ncd-agent" /etc/sudoers.d/ncd-agent.tmp
visudo -cf /etc/sudoers.d/ncd-agent.tmp >/dev/null || { rm -f /etc/sudoers.d/ncd-agent.tmp; die "sudoers file failed validation"; }
mv /etc/sudoers.d/ncd-agent.tmp /etc/sudoers.d/ncd-agent

log "nginx include (validated before reload)"
# Install into whichever directory this nginx actually includes in http{}:
# stock Debian/Ubuntu/RHEL load conf.d/*.conf; some panels only load sites-enabled/*.
if nginx -T 2>/dev/null | grep -Eq '^\s*include\s+/etc/nginx/conf\.d/\*\.conf;'; then
  INCLUDE_DIR=/etc/nginx/conf.d
elif nginx -T 2>/dev/null | grep -Eq '^\s*include\s+/etc/nginx/sites-enabled/\*(\.conf)?;'; then
  INCLUDE_DIR=/etc/nginx/sites-enabled
else
  die "nginx includes neither conf.d/*.conf nor sites-enabled/*; add one to nginx.conf"
fi
INCLUDE_FILE="$INCLUDE_DIR/ncd-custom-domains.conf"
# A copy in a directory nginx does not load would silently do nothing, so remove it.
for stale in /etc/nginx/conf.d/ncd-custom-domains.conf /etc/nginx/sites-enabled/ncd-custom-domains.conf; do
  [[ "$stale" != "$INCLUDE_FILE" ]] && rm -f "$stale"
done
install -m 0644 "$SRC/nginx/ncd-custom-domains.conf" "$INCLUDE_FILE.new"
mv "$INCLUDE_FILE.new" "$INCLUDE_FILE"
if ! nginx -t -q; then
  rm -f "$INCLUDE_FILE"
  die "nginx -t failed with the custom-domain include; removed it, nginx unchanged"
fi
nginx -T 2>/dev/null | grep -q 'zone=ncd_req' || die "custom-domain include is not loaded by nginx ($INCLUDE_FILE)"
systemctl reload nginx

log "agent access to its vhost dir"
# Some hosts make /etc/nginx mode 0700, which blocks the agent from reaching its
# own directory. Grant traverse-only (x) on /etc/nginx to the agent user: no
# read or list access to the rest of the nginx config.
if ! sudo -u ncdagent test -w /etc/nginx/ncd-custom-domains; then
  command -v setfacl >/dev/null || die "setfacl not found (install the acl package)"
  setfacl -m u:ncdagent:x /etc/nginx
fi
sudo -u ncdagent test -w /etc/nginx/ncd-custom-domains || die "ncdagent still cannot write /etc/nginx/ncd-custom-domains"

log "systemd"
install -m 0644 "$SRC/systemd/ncd-agent.service" /etc/systemd/system/ncd-agent.service
systemctl daemon-reload
systemctl enable ncd-agent >/dev/null
systemctl restart ncd-agent
systemctl is-active --quiet ncd-agent || { journalctl -u ncd-agent -n 30 --no-pager; die "agent failed to start"; }

log "done. Follow logs with: journalctl -u ncd-agent -f"
