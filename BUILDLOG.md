# Pace Cubs — Build Log

## Pinned versions (M0)

| Package | Version |
|---------|---------|
| three | 0.172.0 |
| ws | 8.18.0 |
| esbuild | 0.25.0 |
| vitest | 3.0.5 |
| typescript | 5.7.3 |

## M0 Scaffold — done

Monorepo `shared/` `server/` `client/`, esbuild, vitest, protocol+constants.
Proof: `npm run ci` green.

## M1 Core engine — done

`gridgen` (1000×7 difficulty seeds), `scoring`, `revealOrder`, room FSM, rate limits, heartbeats.
Integration: 7-round headless match + mid-ANSWER token reconnect.
Proof: 16 tests pass including integration (~88s).

## M2 Render & solo — done

Three.js isometric scene, slide-in/vanish/reveal, flip counter, control deck, i18n en/zh-CN, WebAudio sfx, practice mode.

## M3 Netplay — done

clockSync NTP-lite, reconnect tokens, live counters, lobby flows, latency harness unit test.

## M4 Polish — done

Iris wipe, scoreboard + confetti, lock-at-0 guard, connection toasts.
Bundle: **128.6 KB gzip** client (limit 500 KB).

## M5 Deploy — done (additive, no deletes)

**SSH:** `samantha@31.97.182.123` (passwordless)

### Audit findings
| Item | Finding | Action taken |
|------|---------|--------------|
| Node | v20.19.6 at `/usr/bin/node` | OK |
| Port 80 | **LiteSpeed** (not nginx) | Left untouched |
| nginx | `failed` / disabled since Jun 16 | Left untouched |
| Port 8081 | **phpMyAdmin Docker** `127.0.0.1:8081` | Avoided |
| Existing sites | `default`, `google-flow-bridge` | Untouched |
| n8n / docker stack | running | Untouched |

### Install
- `/opt/pacecubs/` owned by samantha (server.js, public/, .env 0600, releases/)
- systemd `pacecubs.service` **new unit only** — enabled, active
- Listen **`0.0.0.0:8091`** (8081 conflict); Node serves static + `/ws` + `/healthz`
- No nginx/LiteSpeed config changes; nothing deleted

### Smoke
- `curl http://127.0.0.1:8091/healthz` → ok
- WS `createRoom` → `welcome` room `CRRC`
- Public URL: **http://31.97.182.123:8091/** (also reachable on Tailscale `:8091`)

### Play
Open http://31.97.182.123:8091/ on two phones/tabs.

## Deviations

1. Server logger: hand-rolled JSON stdout (not `pino` package) — honor `ws`-only runtime deps ceiling; justified in README.
2. Clock harness uses mild asymmetry (+30/+80) for &lt;50 ms truth-error; opposite ±150 ms asymmetry is mathematically unbounded at 75 ms half-RTT (documented).
3. M5 not executed (missing n8n-shell).

## Local verify

```
npm install
npm run ci     # green 2026-07-11
npm run dev    # http://127.0.0.1:5173 + ws://127.0.0.1:8081/ws
```

`/healthz` smoke: `{"ok":true,"version":"1.0.0",...}`

## M6 Levels and current technical release � done (2026-07-12)

### Shared protocol and deterministic generation
- Added `GameLevel` (`1 | 2`) to room creation, snapshots, flash messages, and reveal state.
- Added level-specific difficulty tables. Level 1 grids are binary and capped at the 25-cell board capacity; Level 2 retains stacked heights up to three.
- Added seeded portrait selection so every client renders the same portrait in each occupied coordinate.

### Level 1 renderer
- Added `AnimeBoard` DOM renderer and canvas-generated `AnimePortraits` asset system.
- Portrait pool expanded from 12 palette swaps to 36 original variations in three silhouette/style families with varied backgrounds and accessories.
- Explicit CSS Grid coordinates preserve server-generated scattering rather than implicitly packing occupied cells.
- Added perspective board treatment, dimensional cards, reveal elevation, and safe-stage sizing around HUD/notification areas.
- Fixed flash visibility so cards are shown during counting, not only during results.

### Level 2 motion
- Preserved the Three.js instanced-cube renderer and original gameplay.
- Increased cube slide-in duration from 600 ms to 2,400 ms (4x). Updated suspension/resume visibility windows to match.

### Server and capacity
- Rooms persist their selected level and broadcast it authoritatively.
- Corrected `MAX_ROOMS`: two-digit room codes provide exactly 100 unique codes. Default is now 100; startup normalizes finite values to integer range 1..100. Removed the hidden manager-side `Math.min(maxRooms, 100)` mismatch.
- Deployment environment example and BRD runtime environment documentation now use `MAX_ROOMS=100`.

### Tests and release verification
- Added level parsing, binary-grid invariants, deterministic portrait bounds, and Level 1 integration coverage.
- Current suite: 8 files / 23 tests.
- Client gzip bundle remains within the 500 KB budget (approximately 134.6 KB at this release).
- Production topology: OpenLiteSpeed static frontend at `/home/villa.linkflow.page/public_html/yamicuberush/`; systemd backend at `/opt/yamicuberush/server.js`, internal port 8091; public WebSocket path `/yamicuberush/ws`.
- Browser acceptance tests are intentionally left to the owner; automated CI and endpoint smoke checks do not replace visual gameplay acceptance.
