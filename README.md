# Pace Cubs

Browser-based real-time multiplayer cube-counting party game.

## Quick start

```bash
npm install
npm run dev
```

- Client: http://127.0.0.1:5173  
- Server WS: ws://127.0.0.1:8081/ws  
- Health: http://127.0.0.1:8081/healthz  

Open two tabs → Create room / Join with code, or **Practice solo**.

```bash
npm run ci      # typecheck + tests + build + bundle budget
npm test
npm run build
```

## Stack

| Layer | Choice |
|-------|--------|
| Client | Three.js 0.172 + TypeScript + esbuild (no framework) |
| Server | Node 20 + `ws` |
| Shared | Protocol types, gridgen, scoring |
| Deploy | Hostinger VPS, Nginx, systemd (via n8n-shell) |

## Protocol

See `shared/src/protocol.ts` and BRD §7.

## Decisions appendix

- **Logger:** minimal JSON stdout logger instead of `pino` to honor runtime deps ceiling (`ws` only on server). Justification recorded per §5.3 / NFR-7.
- **Dev WS:** on port 5173, client connects to `:8081/ws` directly.
- **M5 deploy:** requires `n8n-shell` skill — if unavailable, build artifacts are ready under `dist/` for manual deploy.

## License

Private — owner project.
