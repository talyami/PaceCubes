# Pace Cubs deploy notes

Target: Hostinger VPS `31.97.182.123`
Remote ops: **n8n-shell skill only** (sandbox cannot SSH).

## Layout
- `/opt/pacecubs/server.js` — esbuild bundle
- `/opt/pacecubs/public/` — static client
- `/opt/pacecubs/.env` — chmod 600
- systemd: `pacecubs.service`
- nginx site: `pacecubs` (additive; never overwrite default if claimed)

## Rollback
Re-extract previous `releases/*.tgz` (keep last 3) → `systemctl restart pacecubs`.

## TLS
Deferred until domain (OPEN-1). Client already derives `wss://` when page is HTTPS.
