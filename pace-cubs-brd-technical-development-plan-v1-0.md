# Pace Cubs — BRD & Technical Development Plan (v1.0)

Complete Business Requirements Document and technical build plan for the Pace Cubs web-based multiplayer cube-counting party game. Written as the single source of truth for an autonomous builder agent: game rules reverse-engineered from reference video, locked tech decisions, full protocol spec, deployment runbook for the Hostinger VPS via n8n-shell, testing gates, and milestones.

## 0. Document Control & Locked Decisions

**Version:** 1.0 · **Date:** 2026-07-11 · **Author:** Super (Hyperagent) · **Status:** ✅ Ready for build
**Audience:** An autonomous builder agent ("the Builder") and the product owner.

**Source materials (both attached to the originating thread):**
1. `pace cubs game.md` — owner's architecture sketch (stack, VPS, sync approach). Treated as *constraints*, refined here.
2. `game.mp4` — 39s reference video (720×1280, 30fps) of the original console party game, analyzed frame-by-frame at 1–3fps. Treated as *ground truth for gameplay, UI, and feel*.

**How to use this document:** Part A (§1–§4) defines WHAT to build and why — read it to understand intent and requirements. Part B (§5–§12) defines HOW — architecture, protocol, algorithms, deployment, tests, and milestone order. Sections use MUST/SHOULD/MAY per RFC 2119. Anything marked **[OPEN]** has a chosen default; the Builder proceeds with the default and never blocks on it.

### Locked decisions (do not re-litigate during build)

| # | Decision | Value | Rationale |
|---|----------|-------|-----------|
| D1 | Frontend stack | **Three.js (pinned exact version at scaffold time, ≥0.165) + TypeScript + esbuild, no framework** | Owner's md allows Three.js or Godot; Three.js gives smallest bundle, no engine export pipeline, trivially iterable in plain TS. Godot rejected: WASM export weight + slower iteration for this scope. |
| D2 | Backend | **Node.js 20 LTS + native `ws` library** (not Socket.io) | md allows either; `ws` is dependency-light and we must hand-roll heartbeats anyway (md requires explicit ping/pong). Reconnect protocol specified in §7. |
| D3 | Language / layout | **TypeScript everywhere; npm-workspaces monorepo** `shared/` `server/` `client/` | One protocol type file shared by both sides eliminates schema drift. |
| D4 | Grid | **5×5 cells, stack heights 0–3** | Matches video exactly. |
| D5 | Match length | **7 rounds**, difficulty table in §3.4; sudden-death on tie | Video shows escalating rounds; 7 gives a ~4-min match. |
| D6 | Scoring | Exact = 3 pts; else unique closest = 1 pt; error tie → earliest lock wins the point | §3.6. Deterministic, party-fair. |
| D7 | Sync | Server-authoritative absolute timestamps + NTP-style client offset (min-RTT of 5 samples) | Per owner's md §3. Skew budget: <50 ms p95. |
| D8 | Players/room | 2–8 (UI optimized for 2–4); solo practice allowed | md says "lobby"; video shows 2. |
| D9 | Deployment | Hostinger VPS `31.97.182.123`, Nginx reverse proxy, systemd service, **all remote ops via the `n8n-shell` skill** (sandbox cannot SSH) | Owner's md §1/§4 + platform constraint (see §10). |
| D10 | TLS | Phase 1: HTTP+WS on the bare IP. WSS+Let's Encrypt only when a domain is provided **[OPEN-1]** | Browsers require a valid cert for WSS; no domain is on file. |
| D11 | Copy/i18n | English default with zh-CN string table matching the video; runtime toggle | §3.8. |
| D12 | Analytics | Fire-and-forget batched POSTs to an n8n webhook (env `ANALYTICS_WEBHOOK_URL`, degrade silently if unset) | Owner's md §4. |

### Open items (defaults chosen — never block)

| ID | Question | Default until answered |
|----|----------|------------------------|
| OPEN-1 | Domain name for TLS/WSS? | Serve HTTP+WS on `http://31.97.182.123` |
| OPEN-2 | Sound effects? | Tiny WebAudio-synthesized blips (no asset files), mute toggle |
| OPEN-3 | Default language | English (`en`), zh-CN toggle |
| OPEN-4 | n8n analytics webhook URL | Env var unset → analytics disabled, everything else works |

## A·1 Product Overview

### 1.1 One-liner
**Pace Cubs** is a browser-based, real-time multiplayer party game: cube stacks flash on an isometric grid for about a second, then every player frantically mashes **+1** to tally how many cubes they saw and locks in their answer. Closest count wins the round; the reveal animation counts the cubes back one-by-one in green while everyone watches their guess get humiliated or crowned.

### 1.2 Background
The reference video shows a couple playing the original on a TV with two gamepads — same screen, split controls (ZL/ZR = +1, L/R = lock). The owner wants a **web-native adaptation**: each player on their own phone/laptop, joined into a room, with the flash synchronized across devices so nobody gets extra viewing time. The core comedy — confidently locking "22" when the answer was 14 — must survive the port.

### 1.3 Goals
- G1: A stranger can go from URL → in a match with a friend in under 60 seconds (room code flow, no accounts).
- G2: The flash moment feels simultaneous on all devices (skew imperceptible; measured p95 < 50 ms).
- G3: Mashing +1 feels arcade-instant on mobile (zero tap delay, haptic tick).
- G4: Runs entirely on the owner's existing Hostinger VPS with zero external paid services.
- G5: Codebase small and boring enough that one agent can build, test, and deploy it end-to-end.

### 1.4 Target users & platforms
- Primary: 2–4 friends/couples on smartphones (portrait), same room or remote, sharing a link.
- Secondary: desktop browsers (keyboard: Space = +1, Enter = lock).
- Support matrix (MUST): last-2-versions Chrome/Safari/Firefox/Edge, iOS Safari ≥16, Android Chrome ≥110. WebGL1 fallback acceptable; WebGPU explicitly out of scope.

### 1.5 Success criteria (v1 acceptance)
- Full 7-round match completes between two real phones on different networks with correct scoring.
- Measured flash skew p95 < 50 ms (clients report `actual − scheduled` via analytics sampling).
- Reveal total always equals `sum(grid)` — zero tolerance.
- 15 presses/second registers 100% of presses (no lost inputs at mash speed).
- Mid-match phone refresh → rejoins the same seat within 60 s and finishes the match.
- JS bundle ≤ 500 KB gzip; 60 fps flash/reveal animations on a mid-tier Android; Lighthouse mobile perf ≥ 85.
- Server idles < 300 MB RAM and survives `systemctl restart` cleanly (rooms are in-memory and lost — acceptable v1).

## A·2 Reference Video Analysis (Ground Truth)

Reverse-engineered phase-by-phase from `game.mp4`. The web build MUST reproduce this experience; console controls map to on-screen buttons.

### 2.1 Observed screens & flow
1. **Instruction/intro** — headline 「请用最快的速度来数。」 (*"Count as fast as you can."*) above a large circled countdown ② → ①. White background throughout the whole game.
2. **Round countdown** — title 「请记住」 (*"Remember!"*), large digits **3 → 2 → 1** (1 s each) above an **empty dotted-outline isometric 5×5 grid**, light grey on white.
3. **Flash** — cube stacks **slide in from the screen edges** onto the grid (staggered, fast, ease-out), sit briefly (~1–1.5 s), then vanish, leaving the dotted grid. Cubes are white with soft grey face shading and subtle edges; stacks observed 1–3 cubes tall; early rounds flat and sparse (4–6), later rounds dense (14–30) with many stacks.
4. **Answer** — title 「箱子的数量是？」 (*"How many cubes?"*) over the empty grid. Bottom corners: each player's **2-digit split-flap/flip counter** with a mechanical flip animation, plus control legend (`ZL +1` / `L 结束!` left player; `ZR`/`R` right player). Both counters visible live to both players — the social-pressure mechanic. Observed mash pace ≈ 2–4 presses/s sustained.
5. **Lock-in** — when a player presses Finish, their flip-counter chrome disappears and their answer becomes a **large static numeral** parked at their screen corner. Other players may still be counting.
6. **Reveal** — the stacks **reappear** in place; cubes fill **bright green one-by-one** (back-to-front, bottom-up) while the true count ticks up in large digits at top center. Players' locked answers flank the grid (observed: truth ~14, answers 21 and 22 — overshoot is common and hilarious; this is the product's money shot).
7. **Next round** — countdown restarts; difficulty escalates.
8. **End** — dark **iris/circle wipe** with 「结束」 (*"Finished"*). (Video cuts here; final scoreboard is our design, §3.7.)

### 2.2 Measured timings (from frame analysis @1–3 fps)
| Phase | Observed | Spec value (locked) |
|---|---|---|
| Intro countdown | ~1 s/step | 3 steps × 1 s |
| Round countdown | 3→2→1, 1 s/step | 3.0 s |
| Slide-in | < 1 s total, staggered | 0.6 s + 40 ms stagger/stack |
| Hold (visible) | ~1.0–1.5 s | Per difficulty table §3.4 |
| Vanish | ~0.25 s | 0.25 s fade+scale-out |
| Answer phase | until both lock (no visible timer) | 20 s cap, auto-lock |
| Reveal fill | rapid per-cube tick | 120 ms/cube + 1.5 s hold |

### 2.3 Visual language (locked palette)
| Element | Value |
|---|---|
| Background | `#f7f7f5` |
| Grid dotted lines | `#c8c8c8`, dash ~0.08 / gap 0.06 world units |
| Cube faces | white `#f4f4f8`, Lambert shading via 1 ambient + 2 directional lights (top-biased) |
| Cube edges | black @ 15% alpha, 1 px |
| Reveal fill | green `#34d434` |
| Text | near-black `#222`, clean grotesk (Inter; Noto Sans SC for zh) |
| End wipe | `#1a1a1a` circle clip-path, white text |
| Camera | true isometric: orthographic, position direction (1,1,1) → lookAt grid center (azimuth 45°, elevation ≈ 35.26°) |

### 2.4 Control mapping (console → web)
| Console | Web mobile (bottom 40% DOM layer) | Web desktop |
|---|---|---|
| ZL / ZR (+1) | Giant **+1** button (~70% width of control area, min 44 px targets, `pointerdown`+`touchstart`, `touch-action: manipulation`, optional `navigator.vibrate(10)`) | **Space** |
| L / R (结束!) | **LOCK IN** button (visually secondary, guarded against accidental first-tap for 300 ms after answer phase starts) | **Enter** |

## A·3 Game Design Specification

### 3.1 Core loop (state machine, server-authoritative)
`LOBBY → STARTING → { COUNTDOWN → FLASH → ANSWER → REVEAL → INTERMISSION } × 7 → FINAL → (rematch → STARTING | expire)`

### 3.2 Lobby & rooms
- Create room → server issues a **4-letter room code** (unambiguous alphabet `ABCDEFGHJKMNPQRSTUVWXYZ`, no I/L/O). Share via URL `?room=CODE` or read aloud.
- Join with code + nickname (≤16 chars, sanitized). First player = host; host leaves → host migrates to next-oldest player.
- All players toggle **Ready**; host presses **Start** when ≥1 other ready. **Solo practice** MUST be allowed (start alone) — also the Builder's manual-test path.
- Mid-match joins rejected (`ROOM_IN_MATCH`); rejoining with a `playerToken` is allowed any time (§7.5). Empty rooms destroyed after 60 s; idle lobbies after 30 min.

### 3.3 Round phases (all transitions scheduled as absolute server timestamps)
1. **COUNTDOWN (3.0 s):** title *Remember!*, digits 3→2→1 over empty grid. Server sends `roundIntro` with `flashAt`.
2. **FLASH:** at `flashAt − 300 ms` server sends `flashData{grid}` (late send narrows the console-cheat window); client buffers and renders exactly at local-converted `flashAt`. Slide-in 0.6 s (stagger 40 ms/stack from nearest screen edge, ease-out cubic; `prefers-reduced-motion` → simple fade). Hold per §3.4. Vanish 0.25 s.
3. **ANSWER (≤20 s):** title *How many cubes?* over empty grid. Each `press` increments that player's server-side counter (cap 99); server broadcasts `counter` updates throttled to 10 Hz. `lock` freezes the answer and records server-receipt `lockAt`. All locked → phase ends early. Timeout → unlocked players are **auto-locked at their current value**.
4. **REVEAL:** grid + per-cube fill order + truth + per-player results + updated totals broadcast in one `reveal` message; clients animate green fill at 120 ms/cube (cells sorted by `x+y` ascending = back-to-front, each stack bottom-up), truth ticker synced to fill, then 1.5 s result hold with answers flanking the grid (video layout).
5. **INTERMISSION (2.0 s):** running scoreboard strip.

### 3.4 Difficulty table (locked)
| Round | Cubes (rand incl.) | Max stack height | Hold ms |
|---|---|---|---|
| 1 | 4–6 | 1 | 1500 |
| 2 | 6–9 | 2 | 1500 |
| 3 | 8–12 | 2 | 1200 |
| 4 | 11–15 | 3 | 1200 |
| 5 | 14–19 | 3 | 1000 |
| 6 | 18–24 | 3 | 1000 |
| 7 | 22–30 | 3 | 800 |

Constants live in `shared/src/constants.ts`; sudden-death rounds reuse row 7.

### 3.5 Layout generation (deterministic, seeded)
Clustered random-walk so layouts read as one structure (matches video), not scattered noise:
```
generateGrid(seed, targetCubes, maxH):
  rng = mulberry32(seed); grid = 5×5 zeros; occupied = []; total = 0
  while total < targetCubes:
    c = (occupied empty or rng() < 0.35) ? randomEmptyCell(rng)
        : randomEmptyNeighbor(rng, pick(rng, occupied)) ?? randomEmptyCell(rng)
    h = min(1 + floor(rng() * maxH), targetCubes − total)   // 1..maxH
    grid[c] = h; occupied.push(c); total += h
  return grid   // invariant: sum(grid) === targetCubes; all heights ≤ maxH
```
Server generates and transmits the grid (client never trusts local generation for play); the seed ships too for debugging/replays. MUST be unit-tested for determinism and invariants across ≥1000 seeds.

### 3.6 Scoring (locked, deterministic)
Per round, `error = |guess − truth|`:
- **Exact (error 0): +3 points** — every exact player gets it.
- **No exact player:** the **unique closest** player gets **+1**. Error tie → earliest `lockAt` (server receipt) wins the single point; residual tie (same ms) → lowest sorted `playerId`. Never split points.
- Timeout auto-locked values score normally. Disconnected players score their frozen counter.
**Match:** highest total after round 7. Tie → sudden-death rounds among tied players only (max 3, then co-winners declared).

### 3.7 Final screen
Iris wipe to dark (video) → scoreboard: ranked players, per-round error sparkline (dots colored green=exact / amber=closest / grey), winner crowned with confetti burst (CSS particles, ~1 s). Buttons: **Rematch** (host; same room, scores reset) and **New room**.

### 3.8 Copy table (runtime-switchable `en` / `zh-CN`)
| Key | en | zh-CN (video-faithful) |
|---|---|---|
| intro | Count as fast as you can! | 请用最快的速度来数。 |
| remember | Remember! | 请记住 |
| question | How many cubes? | 箱子的数量是？ |
| plusOne | +1 | +1 |
| lock | LOCK IN! | 结束! |
| locked | Locked | 已锁定 |
| theEnd | Finished! | 结束 |
| winner | {name} wins! | {name} 获胜! |
| draw | It's a draw! | 平局! |
| waiting | Waiting for players… | 等待玩家… |
| ready | Ready | 准备 |
| start | Start game | 开始游戏 |
| roomCode | Room code | 房间号 |
| join | Join | 加入 |
| create | Create room | 创建房间 |
| practice | Practice solo | 单人练习 |
| rematch | Rematch | 再来一局 |
| exact | Exact! +3 | 完全正确! +3 |
| closest | Closest +1 | 最接近 +1 |
| disconnected | {name} disconnected | {name} 已断线 |

## A·4 Requirements, Scope & Risks

### 4.1 Functional requirements (MUST unless noted)
**Rooms & identity**
- FR-1: Create room → 4-letter code; join by code or `?room=` URL; nickname required, sanitized ≤16 chars.
- FR-2: 2–8 players/room; solo practice mode; host migration; ready/start flow.
- FR-3: `playerToken` (UUID, localStorage) rebinds a seat on reconnect ≤60 s, including mid-round; duplicate token connection kicks the older socket.
**Gameplay**
- FR-4: Server generates each round's grid (5×5, heights 0–3) per §3.4–3.5 and is sole source of truth for phases, counters, answers, scores.
- FR-5: Flash renders at the same wall-clock instant on all clients via `flashAt` + clock offset (§8); clients never self-schedule phases.
- FR-6: +1 presses register server-side during ANSWER only, pre-lock only, rate-capped (§9.4), counter cap 99; UI increments optimistically and reconciles.
- FR-7: Live opponent counters broadcast ≤10 Hz (config flag `hideOpponentCount` exists, default **false** — video shows counters public).
- FR-8: Lock-in freezes answer with server timestamp; all-locked ends ANSWER early; 20 s timeout auto-locks.
- FR-9: Reveal animates per-cube green fill + truth ticker; totals MUST equal `sum(grid)`; per-player error, points, and updated totals shown.
- FR-10: Scoring exactly per §3.6; 7 rounds; sudden death; final scoreboard + rematch.
**UX shell**
- FR-11: Portrait mobile-first: top 60% canvas / bottom 40% DOM controls (owner's md); desktop keyboard Space/Enter; landscape adapts side-by-side (SHOULD).
- FR-12: Flip-counter animation for own count; big-numeral locked state (video parity).
- FR-13: i18n en/zh-CN toggle (§3.8); `prefers-reduced-motion` honored everywhere.
- FR-14: Connection status UI: reconnecting toast, opponent-disconnected badge, room-closed error screen.
- FR-15 (SHOULD): WebAudio synth blips — countdown tick, press tick, lock thunk, reveal tick, win sting; mute toggle persisted.

### 4.2 Non-functional requirements
- NFR-1 Sync: flash skew p95 < 50 ms cross-client (analytics-measured).
- NFR-2 Input: zero-tap-delay controls; 15 presses/s lossless end-to-end.
- NFR-3 Perf: ≤500 KB gzip JS; TTI < 3 s on 4G; 60 fps animations on mid-tier Android (DPR clamped ≤2; single `InstancedMesh` for ≤75 cubes).
- NFR-4 Capacity: 1 vCPU / 100 concurrent rooms / 500 sockets; <300 MB RSS; O(rooms) tick loop, no per-frame server work.
- NFR-5 Resilience: ws heartbeat ping 15 s / drop 30 s (owner md requires explicit keep-alive); systemd `Restart=always`; in-memory rooms (loss on restart accepted v1).
- NFR-6 Security: server-authoritative everything; token-bucket rate limits (§9.4); ws `Origin` check; no PII beyond nickname; secrets only in `/opt/pacecubs/.env` (0600); no eval/dynamic code.
- NFR-7 Ops: single-file bundled `server.js` (esbuild) — no `npm install` on the VPS; structured pino logs to journald; analytics per §11.
- NFR-8 Code: TypeScript strict; shared protocol types; unit+integration tests green as merge gate (§12).

### 4.3 Out of scope (v1)
Accounts/auth, matchmaking, spectators, chat/voice, persistence/DB/leaderboards, native apps, Godot/WebGPU paths, replays, cosmetics/monetization, bots, tournaments — **build none of these** even if trivial.

### 4.4 Risks & mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Cheap-device clock jitter breaks sync feel | Core moment ruined | Min-RTT-of-5 offset sampling, 10 s refresh, rAF-gated fire, skew analytics to verify (§8) |
| Mash floods server | Latency spikes | 10 Hz counter broadcast throttle + token bucket + tiny messages (§9.4) |
| Nginx/proxy kills idle ws | Mid-round drops | Heartbeats + `proxy_read_timeout 3600s` + reconnect tokens |
| **n8n already lives on this VPS** — port 80/default-site collision | Could break owner's automation | Runbook step 0 audits nginx/ports first; additive config only; STOP and report if port 80 default is taken (§10.4) |
| No domain → no WSS | Blocks HTTPS-only features | HTTP+WS on IP is fully functional; TLS is a config-only later step (OPEN-1) |
| DevTools cheating (grid inspection) | Party-game trust | `flashData` sent only 300 ms pre-flash; accepted residual risk v1 |
| n8n-shell webhook limits on long installs | Deploy stalls | Short idempotent commands, `nohup` for long ops, poll with follow-up commands (§10.3) |

## B·5 Architecture & Repository Layout

### 5.1 System diagram
```
 Phone A ──┐  HTTPS/HTTP: static assets (Nginx)
 Phone B ──┤  WS(S) /ws ─────────────────────────────► Nginx :80(/443)
 Laptop ───┘                                            │ upgrade + proxy
                                                        ▼
                                       Node 20 `pacecubs.service` :8081 (127.0.0.1)
                                       ├─ RoomManager (Map<code, Room>)
                                       ├─ Room: state machine + authoritative timers
                                       ├─ ClockService (timePing/timePong)
                                       ├─ RateLimiter (token buckets)
                                       └─ Analytics (batched POST) ──► n8n webhook
 Build/deploy control plane (no SSH from sandbox):
 Builder sandbox ──► n8n-shell skill (HTTPS webhook) ──► n8n ──► SSH ──► VPS 31.97.182.123
                └──► PublishFilePublicly (tarball URL) ──► `curl` on VPS pulls artifact
```

### 5.2 Monorepo (npm workspaces)
```
pacecubs/
├─ package.json                # workspaces: shared, server, client; scripts: build/test/dev
├─ tsconfig.base.json          # strict: true
├─ shared/src/
│  ├─ protocol.ts              # ALL C2S/S2C message types + RoomSnapshot etc. (§7)
│  ├─ constants.ts             # timings, difficulty table, palette, limits
│  ├─ gridgen.ts               # mulberry32 + generateGrid (§3.5)
│  ├─ scoring.ts               # scoreRound, matchWinner (§3.6)
│  └─ revealOrder.ts           # grid → ordered [x,y,layer][] (§3.3.4)
├─ server/src/
│  ├─ index.ts                 # http+ws bootstrap, origin check, graceful shutdown
│  ├─ roomManager.ts           # codes, create/join/destroy, TTLs
│  ├─ room.ts                  # per-room state machine + scheduled timers (§9)
│  ├─ player.ts                # seat: token, socket, counter, lockAt, score
│  ├─ heartbeat.ts             # ping 15s / terminate 30s
│  ├─ rateLimit.ts             # token buckets (press/join/msg)
│  └─ analytics.ts             # batched fire-and-forget POST
├─ server/test/                # vitest: gridgen, scoring, room FSM, integration (§12)
├─ client/
│  ├─ index.html               # viewport meta, font preload, #app + #canvas
│  └─ src/
│     ├─ main.ts               # screen router: home/lobby/game/final
│     ├─ net.ts                # ws connect, reconnect+token, send/recv typed
│     ├─ clockSync.ts          # offset estimator (§8)
│     ├─ scene/{renderer,grid,cubes,animations}.ts   # three.js iso scene (§9.6)
│     └─ ui/{screens,counter,buttons,scoreboard,i18n,sfx}.ts
├─ deploy/{nginx-pacecubs.conf, pacecubs.service, env.example, deploy-notes.md}
└─ README.md                   # dev quickstart, protocol pointer, runbook pointer
```

### 5.3 Build toolchain
- **esbuild** for both targets: client → `dist/public/app.js` (+ minify, `metafile` to enforce the 500 KB gzip budget in CI script) with `index.html`/CSS copied; server → single `dist/server.js` (`--platform=node --bundle`), so the VPS needs **only the Node 20 runtime** — no node_modules on the box.
- `npm run dev`: esbuild watch + `node --watch` server on :8081 + static serve; two browser tabs = full local match.
- `npm test`: vitest across workspaces. `npm run build && npm test` MUST be green at every milestone gate.
- Runtime deps ceiling (locked): server = `ws` only; client = `three` only; shared = zero. Dev deps: typescript, esbuild, vitest. Adding anything else requires a written justification line in README.

## B·6 Data Model

```ts
// shared/src/protocol.ts — single source of truth, imported by client & server
export type Grid = number[][];            // 5×5, values 0–3 (stack height per cell)

export interface PlayerPub {
  id: string;            // "p1".."p8" (stable per seat)
  name: string;          // sanitized, ≤16 chars
  ready: boolean;
  connected: boolean;
  score: number;         // running match total
}

export interface RoomSnapshot {
  code: string;                       // "KWPT"
  state: "LOBBY"|"STARTING"|"COUNTDOWN"|"FLASH"|"ANSWER"|"REVEAL"|"INTERMISSION"|"FINAL";
  players: PlayerPub[];
  hostId: string;
  round: number;                      // 1-based; 0 in lobby
  rounds: number;                     // 7 (+ sudden death appended)
  hideOpponentCount: boolean;         // default false
  lang: "en"|"zh-CN";                // room display hint only
}

export interface RoundResult {
  playerId: string;
  value: number;         // locked (or auto-locked) guess
  lockAt: number | null; // server epoch ms; null = timeout auto-lock
  error: number;         // |value − truth|
  points: 0|1|3;
  outcome: "exact"|"closest"|"none";
}
```
**Server-internal per seat (never fully broadcast):** `token` (UUID), `socket`, `counter`, `lockedAt`, `pressBucket`, `lastPong`, `offsetSamples` (debug).
**Server-internal per room:** `seed` (per-round, `crypto.randomInt`), `grid`, `truth`, `phaseTimer`, `createdAt`, `lastActivity`.

**Timestamps:** all protocol times are **server epoch ms** (`Date.now()` on server). Clients convert via their estimated offset (§8) and never send local wall-clock times except inside `timePing`.

**Invariants (assert in dev, test in CI):**
1. `sum(grid) === truth === difficulty target` for the round's seed.
2. `0 ≤ grid[y][x] ≤ maxHeight(round)`.
3. Exactly one `reveal` per round; results array covers every non-left seat exactly once.
4. Points per round ∈ {0,1,3} per player; at most one `closest` point when no `exact` exists.
5. Counter monotonically non-decreasing within a round, ≤99, frozen after lock.

## B·7 Network Protocol (WebSocket)

Transport: single ws connection, JSON text frames `{ t: "type", ...fields }`. Unknown `t` → log + ignore (forward compat). Malformed JSON → `error{BAD_MESSAGE}` then close after 3 strikes.

### 7.1 Client → Server
```ts
type C2S =
  | { t:"createRoom"; name:string; lang?:"en"|"zh-CN" }
  | { t:"joinRoom";  code:string; name:string; playerToken?:string }  // token ⇒ rejoin
  | { t:"ready";     ready:boolean }
  | { t:"startMatch" }                 // host only, LOBBY only
  | { t:"press" }                      // +1; ANSWER phase, pre-lock only
  | { t:"lock" }                       // finish; idempotent
  | { t:"timePing";  t0:number }       // t0 = client Date.now()
  | { t:"pong" }                       // reply to server ping
  | { t:"rematch" }                    // host, FINAL only
  | { t:"leave" };
```
### 7.2 Server → Client
```ts
type S2C =
  | { t:"welcome";    playerId:string; playerToken:string; room:RoomSnapshot; serverNow:number }
  | { t:"roomUpdate"; room:RoomSnapshot }                    // lobby/ready/connect changes
  | { t:"matchStart"; rounds:number; introAt:number }        // intro screen schedule
  | { t:"roundIntro"; round:number; countdownAt:number; flashAt:number; holdMs:number }
  | { t:"flashData";  round:number; grid:Grid; seed:number } // sent at flashAt − 300 ms
  | { t:"counter";    playerId:string; value:number }        // ≤10 Hz per player
  | { t:"locked";     playerId:string }                      // value stays hidden till reveal? No — value already public via counter (unless hideOpponentCount)
  | { t:"reveal";     round:number; grid:Grid; truth:number; order:[number,number,number][];
                      results:RoundResult[]; scores:{playerId:string;score:number}[];
                      nextRoundAt?:number }                  // absent on last round
  | { t:"matchEnd";   scores:{playerId:string;score:number}[]; winnerIds:string[]; endAt:number }
  | { t:"timePong";   t0:number; t1:number }                 // t1 = server Date.now() at receipt
  | { t:"ping" }
  | { t:"error";      code:ErrCode; msg:string };

type ErrCode = "ROOM_NOT_FOUND"|"ROOM_FULL"|"ROOM_IN_MATCH"|"BAD_NAME"|"NOT_HOST"
             | "BAD_PHASE"|"RATE_LIMITED"|"BAD_MESSAGE"|"SEAT_TAKEN"|"SERVER_FULL";
```
### 7.3 Sequence (happy path, 2 players)
```
A createRoom ─► welcome(A, KWPT) ; B joinRoom(KWPT) ─► welcome(B) + roomUpdate ▸ both
both ready ─► roomUpdate ; A startMatch ─► matchStart{introAt}
per round: roundIntro{countdownAt, flashAt, holdMs} ▸ both
           flashData{grid} ▸ both            (flashAt − 300 ms)
           press/press/… ─► counter ▸ both   (throttled)
           lock(A) ─► locked(A) ; lock(B) ─► locked(B) → ANSWER ends early
           reveal{…, nextRoundAt} ▸ both
after R7:  matchEnd{winnerIds} ▸ both ; rematch(host) → matchStart …
```
### 7.4 Heartbeat (owner-md requirement)
Server → `ping` every 15 s per socket; client replies `pong` (and browsers auto-reply protocol-level pings — send app-level anyway for proxy traffic). No `pong` within 30 s → terminate socket (seat enters disconnected state, §7.5). Client side: missing server `ping` for 30 s or ws `close` → reconnect loop with 1 s → 2 s → 4 s… backoff (cap 10 s).

### 7.5 Reconnect & seat lifecycle
- `welcome` delivers `playerToken`; client persists in `localStorage["pacecubs.token"]` and re-sends via `joinRoom`.
- Disconnect ≠ removal: seat marked `connected:false` for **60 s** (counter frozen; still scored). Token rejoin restores the seat and current phase state (server re-sends `roomUpdate` + current `roundIntro`/`flashData`-if-flash-passed + counters). After 60 s the seat is dropped (`roomUpdate`); in a 2-player match the remaining player finishes vs the frozen ghost or exits.
- Same token, second socket → kick the older socket (`SEAT_TAKEN` semantics reversed: newest wins — phone refresh case).

## B·8 Clock Sync & Simultaneity

Goal: every client fires the flash within ±50 ms of the server's intended instant, regardless of individual ping (owner md §3 "client interpolation").

### 8.1 Offset estimation (NTP-lite)
```
client:  t0 = Date.now(); send timePing{t0}
server:  on receipt: send timePong{t0, t1: Date.now()}
client:  t3 = Date.now(); rtt = t3 − t0
         sample.offset = t1 − (t0 + t3)/2      // serverClock − clientClock
         sample.rtt    = rtt
```
- Burst **5 pings** (150 ms apart) on connect; keep the sample with **min RTT** (least queuing noise) → `offset`.
- Refresh: single ping every **10 s**; replace `offset` only if new sample's RTT ≤ 1.5× best-known RTT, else keep (guards against wifi spikes). Also refresh burst on `visibilitychange` → visible and on reconnect.
- Expose `serverToLocal(ts) = ts − offset` in `clockSync.ts`.

### 8.2 Firing phases locally
- On `roundIntro`, client computes `localFlashAt = serverToLocal(flashAt)` and drives countdown digits from the same clock (`ceil((localFlashAt − now)/1000)`) — digits therefore also match cross-device.
- Fire on the **first rAF where `Date.now() ≥ localFlashAt`**; one frame of slop (≤16.7 ms) is inside budget. Never `setTimeout` for the final gate (throttled tabs); use rAF + a 250 ms-early `setTimeout` wake as belt-and-braces.
- Hidden tab at flash time: on `visibilitychange`, if `now > localFlashAt + holdMs` show a "missed it!" state — never replay the flash late (fairness).
- Server is the only phase driver: its own timers move the room FSM at the same absolute times; a slow client that misses a window simply misses it (no per-client stalls).

### 8.3 Verification (feeds NFR-1)
After each flash, client computes `skew = actualFireLocal − localFlashAt` and includes `{skew, rtt, offset}` in one analytics `client_sync_sample` event per match per client (sampled, not per-round). The acceptance test asserts p95 < 50 ms across a scripted 20-round session with `tc`-style simulated ±150 ms asymmetric latency (integration harness injects fake delays around the ws mock instead of OS-level tc — see §12.2).

## B·9 Server & Client Design Detail

### 9.1 Server bootstrap (`index.ts`)
- `http.createServer` (serves nothing but `/healthz` → `200 {rooms, sockets, uptime}`) + `ws.Server({ noServer })` bound via `upgrade` on path `/ws`; listen `127.0.0.1:8081` (Nginx fronts it). Env: `PORT`, `HOST`, `MAX_ROOMS=200`, `MAX_SOCKETS=600`, `ANALYTICS_WEBHOOK_URL?`, `ORIGIN_ALLOW` (comma list; empty = allow all, log origin).
- Graceful shutdown: SIGTERM → stop accepting, `matchEnd`-less `error{SERVER_RESTART}`… keep simple: close sockets with code 1012; clients auto-reconnect and land on a room-not-found → home screen. Document this in README.

### 9.2 Room FSM (`room.ts`)
Single `setPhase(phase, at)` helper schedules the next transition via one `setTimeout` per room (cleared on early-exit conditions like all-locked). All broadcast payloads computed once, stringified once, sent to every connected seat. Timers use absolute targets (`at − Date.now()`) so drift never accumulates.

### 9.3 Press handling
`press` → validate phase/lock → `counter++` (≤99) → mark seat dirty. A per-room **100 ms flush interval** during ANSWER broadcasts dirty counters (≤10 Hz, batched as consecutive `counter` frames). Optimistic client UI means perceived latency ≈ 0 regardless.

### 9.4 Rate limits (token buckets, per socket)
| Action | Rate | Burst | On exceed |
|---|---|---|---|
| `press` | 25/s | 40 | silently drop (never punish mashing) |
| `joinRoom`/`createRoom` | 1/s | 3 | `error{RATE_LIMITED}` |
| any message | 60/s | 100 | close socket 1008 |
Plus per-IP room-creation cap: 10/min (in-memory sliding window).

### 9.5 Client screens (`main.ts` router)
`HOME` (create / join / practice, name field, lang + sound toggles) → `LOBBY` (code huge + copy-link, player list, ready, start) → `GAME` (§9.6) → `FINAL` (scoreboard, rematch). URL `?room=CODE` deep-links join. All screens are DOM; only the game board is WebGL.

### 9.6 Game screen composition (video-faithful)
```
┌──────────────────────────────┐  
│   phase title (DOM, top)     │   Remember! / How many cubes?
│   big digits (countdown/truth)│
│                              │
│      [three.js canvas]       │  60vh: dotted grid + cubes
│  21                    22    │  locked answers flank grid (reveal)
├──────────────────────────────┤
│   ┌─────┐  flip counter      │  40vh DOM control deck:
│   │ 0 7 │  (own count)       │  opponents' mini counters row
│   └─────┘                    │
│  ┌────────────┐ ┌──────────┐ │
│  │     +1     │ │ LOCK IN! │ │  giant thumb buttons
│  └────────────┘ └──────────┘ │
└──────────────────────────────┘
```
- **Renderer:** `OrthographicCamera` at direction (1,1,1)·d, `lookAt(gridCenter)`, frustum sized to fit 5×5 + height 3 with 10% margin at any aspect; `renderer.setPixelRatio(min(devicePixelRatio, 2))`; resize observer.
- **Grid:** 60 dashed segments via `LineSegments` + `LineDashedMaterial`(color `#c8c8c8`, dashSize .08, gapSize .06) — call `computeLineDistances()`.
- **Cubes:** one `InstancedMesh` (BoxGeometry 0.92³, `MeshLambertMaterial`, vertexColors off, per-instance color white→green via `setColorAt`) — max 75 instances; plus a static `EdgesGeometry` overlay per visible instance is overkill: instead bake edge look with a 64×64 canvas texture (white face, 1px #00000026 border) — cheaper and matches the flat video look. Lights: ambient 0.85 + directional (5,10,7) 0.5 + directional (−3,6,−5) 0.25.
- **Animations** (`animations.ts`, rAF timeline helpers, all cancelable): slide-in (per-stack from nearest edge, 0.6 s cubic-out, 40 ms stagger by `x+y`), vanish (0.25 s scale→0 + fade), reveal fill (order from `revealOrder.ts`, 120 ms/cube: instance color → `#34d434` with 80 ms pop scale 1→1.15→1, truth DOM digits tick in lockstep), reduced-motion variants (opacity only).
- **Flip counter:** CSS 3D split-flap: two digit cards, `rotateX` top-half flip 120 ms on increment; monospace tabular numerals; caps at 99.
- **Buttons:** `pointerdown` (+ `touchstart` fallback) with `preventDefault`, `touch-action: manipulation`, `user-select:none`; press → optimistic counter++, `navigator.vibrate?.(10)` behind setting, sfx tick; LOCK IN ignores input for first 300 ms of ANSWER (anti-fat-finger) and requires one confirmation state if counter is 0 ("Sure? You counted 0").
- **Iris wipe:** full-screen div, `clip-path: circle(150% → 0%)` 700 ms into `#1a1a1a`, text 结束 / Finished!, then FINAL screen.
- **SFX (`sfx.ts`):** WebAudio oscillator blips (no assets): countdown 660 Hz 60 ms, press 880 Hz 25 ms, lock 220 Hz 120 ms, reveal tick 990 Hz 20 ms, win arpeggio; master gain 0.15; unlocked on first user gesture; persisted mute.

## B·10 Deployment & Operations (Hostinger VPS via n8n-shell)

### 10.1 Hard constraints
- Target: Hostinger VPS `31.97.182.123`; admin path per owner md: Tailscale `100.95.240.61`, user `samantha`.
- **The Builder's sandbox cannot SSH/SCP (HTTP-only egress).** ALL remote commands MUST go through the **`n8n-shell` skill** (HTTPS webhook → n8n SSH node). Load it via `SearchKnowledge("n8n-shell")` → `GetKnowledgeDetails` → `FetchSkillScripts`/`RunWithCredentials`. If the skill is missing or failing, **STOP and report — never attempt raw SSH, never pick another host.**
- File transfer: no SCP ⇒ build tarball in sandbox → `SaveFile` + `PublishFilePublicly` → on VPS `curl -L <url> -o /tmp/pacecubs.tgz` → verify `sha256sum` → extract → **`UnpublishFile` immediately after**.
- ⚠️ **This VPS already runs the owner's n8n instance.** Every step MUST be additive and non-destructive: audit before touching Nginx/ports; never edit or remove existing sites/services; if port 80 `default_server` or the target root is already claimed, capture the conflict and report back instead of overriding.

### 10.2 Target layout on VPS
```
/opt/pacecubs/            # owned by samantha
├─ server.js              # esbuild single-file bundle
├─ public/                # index.html, app.js, styles.css, fonts
├─ .env                   # PORT=8081 HOST=127.0.0.1 ANALYTICS_WEBHOOK_URL=… (chmod 600)
└─ releases/<ts>.tgz      # last 3 kept for rollback
/etc/systemd/system/pacecubs.service
/etc/nginx/sites-available/pacecubs → sites-enabled symlink
```

### 10.3 Runbook (each numbered step = one-or-few short idempotent n8n-shell commands; long ops use `nohup … & echo started`, then poll)
0. **Audit (read-only):** `node -v; nginx -v; ss -tlnp | grep -E ':80|:443|:8081'; ls /etc/nginx/sites-enabled/; systemctl is-active nginx` → record findings in build log; resolve conflicts per 10.1 before proceeding. If Node <20: install Node 20 LTS via NodeSource setup script (document exact commands run).
1. **Stage artifact:** local `npm run build && npm test` green → `tar czf pacecubs-v<semver>.tgz -C dist .` → publish → on VPS: mkdir, curl, sha256 check, extract to `/opt/pacecubs`, keep tarball in `releases/` → unpublish the URL.
2. **Env:** write `/opt/pacecubs/.env` (0600) from `deploy/env.example`; never echo secrets into logs.
3. **systemd:** install `deploy/pacecubs.service` →
```ini
[Unit]
Description=Pace Cubs game server
After=network.target
[Service]
User=samantha
WorkingDirectory=/opt/pacecubs
EnvironmentFile=/opt/pacecubs/.env
ExecStart=/usr/bin/node /opt/pacecubs/server.js
Restart=always
RestartSec=2
MemoryMax=512M
[Install]
WantedBy=multi-user.target
```
`daemon-reload && enable --now pacecubs && systemctl status pacecubs` (assert active) && `curl -s localhost:8081/healthz`.
4. **Nginx (additive site):** install `deploy/nginx-pacecubs.conf` →
```nginx
server {
  listen 80;                      # add default_server ONLY if audit showed none
  server_name _;                  # replace with domain when OPEN-1 resolves
  root /opt/pacecubs/public;
  location / { try_files $uri /index.html; }
  location /ws {
    proxy_pass http://127.0.0.1:8081;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_read_timeout 3600s;   # ws idle safety alongside app heartbeats
  }
  location /healthz { proxy_pass http://127.0.0.1:8081/healthz; }
}
```
symlink → `nginx -t` (MUST pass before) → `systemctl reload nginx`.
5. **Smoke (from sandbox, plain HTTPS/HTTP):** `curl -I http://31.97.182.123/` = 200 + HTML; `/healthz` = 200 JSON; ws handshake check via a 10-line Node script run **on the VPS** through n8n-shell (sandbox egress may not allow raw ws to the IP): connect, `createRoom`, expect `welcome`, exit 0.
6. **Real-device verify:** owner opens URL on two phones → full match. Capture analytics `client_sync_sample` skews.
7. **TLS (deferred until OPEN-1):** point domain A-record → certbot `--nginx` → client auto-selects `wss://` when `location.protocol === "https:"` (client MUST derive ws URL as `(https?'wss':'ws')://host/ws` from day one).
8. **Rollback:** re-extract previous `releases/*.tgz` → `systemctl restart pacecubs`. Keep 3.

### 10.4 Failure policy
Any audit conflict, permission failure, or unexpected service on target paths/ports → capture exact command + output in the build log, do not force, report to owner with a proposed remedy. (Resource-safety rule: never repurpose or overwrite existing infrastructure.)

## B·11 Observability & Analytics

### 11.1 Logs
- `pino` (JSON) → stdout → journald. Levels: info (lifecycle), warn (rate-limit, bad messages), error (exceptions). One line per room event, `{room, playerId, event}` — never log tokens or full payloads.
- `journalctl -u pacecubs -f` is the documented ops view (via n8n-shell).

### 11.2 Analytics → n8n webhook (owner md §4)
`analytics.ts`: in-memory queue, flushed every 10 s or at 20 events, single `POST ANALYTICS_WEBHOOK_URL` with `{batch: Event[]}`, 2 s timeout, **fire-and-forget** (failures logged at warn once/min, never retried aggressively, zero impact on game loop). Disabled cleanly when env unset.
```ts
interface Event { event: string; ts: number; room?: string; data?: object }
```
| event | data |
|---|---|
| `server_start` | `{version}` |
| `room_created` / `room_destroyed` | `{players}` |
| `match_started` | `{players, rounds}` |
| `round_result` | `{round, truth, results:[{value,error,points}]}` (no names) |
| `match_end` | `{scores, durationMs}` |
| `player_disconnected` / `player_rejoined` | `{phase}` |
| `client_sync_sample` | `{skew, rtt, offset}` (client-reported via ws `press`-channel? No — dedicated C2S `{t:"sync", …}` relayed server→queue) |
| `error` | `{code, where}` |
Add `{ t:"sync"; skew:number; rtt:number; offset:number }` to C2S in `protocol.ts` (1/match/client, server rate-caps to 3).

### 11.3 Health
`/healthz` JSON: `{ok, uptimeS, rooms, sockets, version}` — used by the deploy smoke test; owner MAY point an n8n cron at it later (out of scope to build).

## B·12 Testing Strategy & Acceptance Gates

### 12.1 Unit (vitest, `shared` + `server`)
- **gridgen:** 1000 seeded runs per difficulty row → `sum===target`, heights ≤ maxH, determinism (same seed ⇒ deep-equal grid), distribution sanity (≥2 distinct occupied cells when target >3).
- **scoring:** table-driven: exact single/multi (+3 each), unique closest (+1), error tie → earlier `lockAt`, same-ms tie → playerId order, timeout auto-lock scores, disconnected frozen counter, sudden-death trigger, co-winner cap.
- **revealOrder:** covers every cube exactly once; back-to-front (`x+y` ascending), bottom-up per stack.
- **room FSM:** legal transitions only; `press` outside ANSWER rejected; all-locked early-exit clears timer; auto-lock at timeout; host migration; 60 s seat drop; rematch resets scores/round.
- **rateLimit:** buckets refill correctly; press drops silent; message flood closes.

### 12.2 Integration (vitest, real server on ephemeral port + 2–4 real `ws` clients)
- Scripted full 7-round match: assert every client got identical `flashAt`/grids, reveal truth === sum, final scores match hand-computed expectation from scripted presses/locks.
- **Latency harness:** wrap client sockets with asymmetric artificial delays (+30/+180 ms) and skewed fake clocks (±700 ms) → run offset estimator → assert computed local fire times of all clients within 50 ms of each other (this is the NFR-1 gate in CI, complementing real-device sampling).
- Reconnect: kill client B socket mid-ANSWER → rejoin with token → counter preserved → match completes.
- Chaos: 30 msg/s garbage frames → socket closed, room healthy; 25/s press ×2 players sustained 20 s → zero missed valid presses (compare server counter to sent-valid count).

### 12.3 Manual acceptance checklist (run before AND after VPS deploy)
1. Two browser tabs: create/join via code AND via `?room=` link.
2. Solo practice runs end-to-end.
3. Phone (portrait): buttons thumb-reachable, no tap delay/zoom/text-selection; flip counter animates; haptic ticks (Android).
4. Flash looks simultaneous side-by-side (film both phones at 120 fps slow-mo; eyeball < ~2 frames).
5. Lock at 0 asks confirmation; late joiner during match politely rejected; host refresh mid-lobby migrates host back on rejoin.
6. Airplane-mode 5 s mid-ANSWER → reconnect toast → seat restored.
7. zh-CN toggle renders video-parity strings; reduced-motion mode never slides/flips (fades only).
8. Kill server mid-match (`systemctl restart`) → clients land on home with a friendly error, can start a new room.
9. Reveal count matches manual count of on-screen cubes across 5 rounds (record a video, count frame-by-frame once).
10. Analytics rows arrive in n8n (if OPEN-4 URL provided).

### 12.4 CI gate (local script `npm run ci`)
`typecheck → unit → integration → build → bundle-size assert (≤500 KB gz client, server.js exists)`. Every milestone ends with `npm run ci` green; deploy (M5) additionally requires §12.3 items 1–2 pre-deploy and 1–10 post-deploy.

## B·13 Milestones & Builder Execution Brief

### 13.1 Milestones (strict order; each ends with `npm run ci` green + a one-paragraph build-log entry)
| M | Scope | Definition of Done |
|---|---|---|
| **M0 Scaffold** | Monorepo, tsconfig strict, esbuild client+server, vitest wiring, `protocol.ts` + `constants.ts` stubs, dev script | `npm run dev` serves a hello page + ws echo; `npm run ci` green |
| **M1 Core engine** | `gridgen`, `scoring`, `revealOrder`, room FSM + timers, rate limits, heartbeats — all unit tests §12.1 | 2 scripted `ws` clients complete a headless 7-round match in the integration test |
| **M2 Render & solo** | Three.js iso scene, grid, cubes, all animations, control deck, flip counter, screens, i18n, sfx; **practice mode against local server** | Solo practice fully playable and video-faithful on phone-sized viewport; reduced-motion path works |
| **M3 Netplay** | clockSync, reconnect/tokens, live counters, lobby flows, latency harness test §12.2 | Two browser tabs (and two LAN devices) complete a real match; sync CI gate green |
| **M4 Polish** | Reveal choreography timing, iris wipe, final scoreboard + confetti + rematch, lock-at-0 guard, connection toasts, bundle budget pass | Manual checklist §12.3 items 1–7 pass locally |
| **M5 Deploy** | Runbook §10.3 steps 0–6 on the VPS via n8n-shell, analytics live, rollback tested once | Playable at `http://31.97.182.123` from two phones; checklist 1–10 pass; runbook results + rollback proof in build log |

### 13.2 Execution brief for the Builder agent (paste-ready mission constraints)
- **Primary spec = this document.** Where it is silent, match the reference video; where both are silent, choose the simplest option and record it in `README.md → Decisions appendix`. Do not re-open Locked Decisions (§0).
- Work in `/agent/workspace/pacecubs`. Keep a running `BUILDLOG.md` (per-milestone: what/proof/deviations).
- Never ask the owner to run commands; execute everything yourself. VPS access **only** via the `n8n-shell` skill (§10.1); artifact transfer only via publish→curl→unpublish. On any infra conflict or missing credential: stop, report, propose.
- Verify with tests, not vibes: `npm run ci` at every milestone; do not advance with red gates. When rendering, screenshot the flash/reveal states and compare against §2.3 palette/layout before calling M2 done.
- Pin exact dependency versions at M0 (`three`, `ws`, `esbuild`, `vitest`, `typescript`) and record them in BUILDLOG.
- Budget discipline: if client bundle exceeds 500 KB gzip, cut features per §4.3 priorities (sfx first, confetti second) — never add a bundler plugin to "fix" it.
- Definition of project done = M5 DoD + §1.5 success criteria demonstrably met + this doc's §12.3 checklist recorded in BUILDLOG with results.

### 13.3 Post-v1 backlog (recorded, NOT built)
TLS/WSS on domain (OPEN-1), spectator mode, >8 players / party-royale, persistent leaderboards (SQLite), themed cube skins, colorblind-safe reveal palette option, PWA install + wake-lock, replay sharing (seed + answers permalink), Telegram/Slack "match result" webhook card.
