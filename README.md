# YAMI CUBE RUSH

Browser-based real-time multiplayer cube-counting party game.

## Quick start (Local Development)

```bash
npm install
npm run dev
```

- **Client:** http://127.0.0.1:5173
- **Server WS:** ws://127.0.0.1:8091/ws
- **Health:** http://127.0.0.1:8091/healthz

Open two tabs → Create room / Join with code, or **Practice solo**.

```bash
npm run ci      # typecheck + tests + build + bundle budget
npm test
npm run build
```

## Stack

| Layer | Choice |
|-------|--------|
| Client | Three.js 0.172 + Vanilla TypeScript + esbuild (no framework) |
| Server | Node 20 + `ws` |
| Shared | Protocol types, gridgen, scoring |
| Deploy | Hostinger VPS run via systemd & OpenLiteSpeed |

## Production Deployment (VPS)

**Live URL:** https://villa.linkflow.page/yamicuberush/

The application runs on a VPS without Docker or PM2, utilizing `systemd` to keep the backend alive and `OpenLiteSpeed` to serve the static frontend and proxy WebSocket traffic.

### Architecture
- **Frontend (Static):** Served by OpenLiteSpeed from `/home/villa.linkflow.page/public_html/yamicuberush/`
- **Backend (Node):** Managed by `systemd` (`yamicuberush.service`), running from `/opt/yamicuberush/server.js` on internal port `8091`.
- **WebSocket Proxy:** OpenLiteSpeed routes `/yamicuberush/ws` to `127.0.0.1:8091`.

### Deployment Procedure

Build the production artifacts locally and verify constraints:

```bash
npm ci
npm run ci
```

Push the frontend and backend artifacts to the remote VPS using `scp`:

```bash
# 1. Update the backend bundle
scp dist/server.js samantha@31.97.182.123:/opt/yamicuberush/server.js

# 2. Update the frontend static files
scp dist/public/* samantha@31.97.182.123:/home/villa.linkflow.page/public_html/yamicuberush/

# 3. Restart the backend service
ssh samantha@31.97.182.123 "sudo systemctl restart yamicuberush.service && sudo systemctl status yamicuberush.service --no-pager"
```

## Protocol

See `shared/src/protocol.ts` and BRD § 7.

## Decisions appendix

- **Logger:** minimal JSON stdout logger instead of `pino` to honor runtime deps ceiling (`ws` only on server). Justification recorded per § 5.3 / NFR-7.
- **Client Bundle:** UI redesign replaced generic forms with a mechanical precision-arcade style. Strict budget size kept < 500 KB gzip limit (currently ~130 KB). 

## License

Private — owner project.
