import type {
  Grid,
  PhaseSync,
  RevealState,
  RoomSnapshot,
  RoundResult,
  ScoreTotal,
  S2C,
} from "@yamicuberush/shared";
import { LOCK_GUARD_MS } from "@yamicuberush/shared";
import { ClockSync } from "./clockSync.js";
import {
  clearActiveSession,
  getActiveSession,
  Net,
  storeActiveSession,
} from "./net.js";
import { GameScene } from "./scene/renderer.js";
import { FlipCounter } from "./ui/counter.js";
import { t } from "./ui/i18n.js";
import { isMuted, loadMute, setMuted, sfx } from "./ui/sfx.js";

type Screen = "home" | "lobby" | "game" | "final";

const app = document.getElementById("app")!;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

const net = new Net();
const clock = new ClockSync(net);
let scene: GameScene | null = null;

let screen: Screen = "home";
let myId = "";
let room: RoomSnapshot | null = null;
let counters = new Map<string, number>();
let locked = new Set<string>();
let ownLocked = false;
let lockPending = false;
let answerStartedAt = 0;
let lockArmed = false;
let pendingFlash: { grid: Grid; flashAt: number; holdMs: number; round: number } | null = null;
let flashFired = false;
let syncSent = false;
let lastScores: ScoreTotal[] = [];
let winnerIds: string[] = [];
let roundOutcomes = new Map<string, ("exact" | "closest" | "none")[]>();
let optimisticCount = 0;
let authoritativeCount = 0;
let nextAdjustSeq = 1;
let pendingAdjustments = new Map<number, -1 | 1>();
let flip: FlipCounter | null = null;
let irisEl: HTMLElement | null = null;
let phaseText = "";
let phaseDigit = "";
let phaseVersion = 0;
let answerTimer: ReturnType<typeof setInterval> | null = null;

loadMute();

function $(html: string): HTMLElement {
  const d = document.createElement("div");
  d.innerHTML = html.trim();
  return d.firstElementChild as HTMLElement;
}

function toast(msg: string): void {
  let el = document.querySelector(".toast") as HTMLElement | null;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el!.classList.remove("show"), 2200);
}

function showIris(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!irisEl) {
      irisEl = document.createElement("div");
      irisEl.className = "iris";
      document.body.append(irisEl);
    }
    irisEl.textContent = text;
    irisEl.classList.add("active");
    irisEl.classList.remove("closing");
    requestAnimationFrame(() => {
      irisEl!.classList.add("closing");
    });
    setTimeout(() => {
      irisEl!.classList.remove("active", "closing");
      resolve();
    }, 800);
  });
}

function confettiBurst(): void {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const layer = document.createElement("div");
  layer.className = "confetti";
  document.body.append(layer);
  const colors = [
    "#34d434",
    "#222222",
    "#f5c542",
    "#ff5c5c",
    "#5d7cff",
    "#f4f4f8",
  ];
  for (let i = 0; i < 180; i++) {
    const s = document.createElement("span");
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = colors[i % colors.length]!;
    s.style.width = `${5 + Math.random() * 8}px`;
    s.style.height = `${5 + Math.random() * 12}px`;
    s.style.setProperty("--drift", `${-22 + Math.random() * 44}vw`);
    s.style.setProperty("--spin", `${540 + Math.random() * 1080}deg`);
    s.style.animationDelay = `${Math.random() * 1.15}s`;
    s.style.animationDuration = `${1.8 + Math.random() * 1.5}s`;
    layer.append(s);
  }
  setTimeout(() => layer.remove(), 4800);
}

function ensureScene(): GameScene {
  if (!scene) {
    scene = new GameScene(canvas);
    scene.startLoop();
    window.addEventListener("resize", () => scene?.resize());
  }
  return scene;
}

function setScreen(s: Screen): void {
  screen = s;
  canvas.style.display = s === "game" ? "block" : "none";
  if (s === "game") ensureScene().show(true);
  else scene?.show(false);
  render();
}

function nameDefault(): string {
  try {
    return localStorage.getItem("yamicuberush.name") ?? "";
  } catch {
    return "";
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem("yamicuberush.name", n);
  } catch {
    /* ignore */
  }
}

/* ─── Screens ─── */

function renderRail(section: string): string {
  return `
    <header class="app-rail">
      <div class="rail-brand" aria-label="YAMI CUBE RUSH">
        <span class="mini-cube" aria-hidden="true"></span>
        <strong>YAMI CUBE RUSH</strong>
      </div>
      <span class="rail-section">${section}</span>
      <div class="rail-tools">
        <button id="mute" class="rail-button" aria-label="${isMuted() ? t("soundOff") : t("soundOn")}" aria-pressed="${isMuted()}">${isMuted() ? "SND OFF" : "SND ON"}</button>
      </div>
    </header>
  `;
}

function wireRail(el: HTMLElement): void {
  el.querySelector("#mute")?.addEventListener("click", () => {
    setMuted(!isMuted());
    render();
  });
}

function renderHome(): void {
  const rawUrlRoom = new URLSearchParams(location.search).get("room") ?? "";
  const urlRoom = /^\d{2}$/.test(rawUrlRoom) ? rawUrlRoom : "";
  app.innerHTML = "";
  const el = $(`
    <div class="screen" id="home">
      ${renderRail(t("home"))}
      <main class="home-layout">
        <section class="home-hero" aria-labelledby="home-title">
          <p class="eyebrow">MULTIPLAYER COUNTING LAB · 01</p>
          <h1 class="brand brand-stack" id="home-title"><span>YAMI</span><span>CUBE RUSH</span></h1>
          <p class="hero-challenge">${t("challenge")}</p>
          <p class="tagline">${t("intro")}</p>
          <div class="cube-stack" aria-hidden="true">
            <i class="cube cube-a"></i>
            <i class="cube cube-b"></i>
            <i class="cube cube-c"></i>
            <i class="cube cube-d"></i>
            <span class="cube-index">05×05</span>
          </div>
        </section>

        <section class="entry-console" aria-label="${t("create")}">
          <div class="console-heading">
            <span>PLAYER SETUP</span>
            <span>READY / SET / COUNT</span>
          </div>
          <div class="error-banner hidden" id="err" role="alert"></div>
          <div class="field">
            <label for="name">${t("name")}</label>
            <input id="name" maxlength="16" value="${escapeHtml(nameDefault())}" autocomplete="nickname" />
          </div>
          <button id="btn-create" class="primary-action">${t("create")} <span aria-hidden="true">↗</span></button>
          <div class="join-group">
            <div class="field code-field">
              <label for="code">${t("roomCode")}</label>
              <input id="code" maxlength="2" pattern="[0-9]{2}" inputmode="numeric" value="${escapeHtml(urlRoom)}" autocomplete="off" aria-describedby="code-hint" />
              <small id="code-hint">Exactly 2 digits</small>
            </div>
            <button id="btn-join" class="secondary join-action">${t("join")} <span aria-hidden="true">→</span></button>
          </div>
          <button id="btn-practice" class="text-action">${t("practice")} <span aria-hidden="true">＋</span></button>
        </section>
      </main>
    </div>
  `);
  app.append(el);
  wireRail(el);

  const getName = () =>
    (el.querySelector("#name") as HTMLInputElement).value.trim();
  const codeInput = el.querySelector("#code") as HTMLInputElement;
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 2);
  });

  const go = (fn: () => void) => {
    sfx.unlock();
    const n = getName();
    if (!n) {
      (el.querySelector("#err") as HTMLElement).textContent = t("name");
      (el.querySelector("#err") as HTMLElement).classList.remove("hidden");
      return;
    }
    saveName(n);
    fn();
  };

  el.querySelector("#btn-create")!.addEventListener("click", () =>
    go(() => {
      clearActiveSession();
      net.send({ t: "createRoom", name: getName() });
    }),
  );
  el.querySelector("#btn-join")!.addEventListener("click", () =>
    go(() => {
      const code = codeInput.value.trim();
      if (!/^\d{2}$/.test(code)) {
        const error = el.querySelector("#err") as HTMLElement;
        error.textContent = "Room code must be exactly two digits";
        error.classList.remove("hidden");
        return;
      }
      const active = getActiveSession();
      net.send({
        t: "joinRoom",
        code,
        name: getName(),
        playerToken: active?.code === code ? active.token : undefined,
      });
    }),
  );
  el.querySelector("#btn-practice")!.addEventListener("click", () =>
    go(() => {
      clearActiveSession();
      net.send({ t: "createRoom", name: getName() });
      // start after welcome — flagged
      pendingPractice = true;
    }),
  );
}

let pendingPractice = false;

function playerInitial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

function renderLobby(): void {
  if (!room) return;
  const amHost = room.hostId === myId;
  app.innerHTML = "";
  const players = room.players
    .map((p, index) => {
      const badges: string[] = [];
      if (p.id === room!.hostId) badges.push(`<span class="badge host">${t("host")}</span>`);
      if (p.id === myId) badges.push(`<span class="badge you">${t("you")}</span>`);
      if (p.ready) badges.push(`<span class="badge ready">${t("ready")}</span>`);
      if (!p.connected) badges.push(`<span class="badge off">${t("offline")}</span>`);
      const stateClasses = [
        p.ready ? "is-ready" : "",
        p.connected ? "" : "is-offline",
        p.id === myId ? "is-you" : "",
      ].filter(Boolean).join(" ");
      return `
        <li class="player-seat ${stateClasses}">
          <span class="seat-number">${String(index + 1).padStart(2, "0")}</span>
          <span class="seat-marker" aria-hidden="true">${escapeHtml(playerInitial(p.name))}</span>
          <span class="seat-identity">
            <strong>${escapeHtml(p.name)}</strong>
            <small>${p.ready ? t("ready") : t("notReady")}${p.id === room!.hostId ? ` · ${t("host")}` : ""}${p.id === myId ? ` · ${t("you")}` : ""}</small>
          </span>
          <span class="seat-badges">${badges.join("")}</span>
        </li>
      `;
    })
    .join("");

  const me = room.players.find((p) => p.id === myId);
  const el = $(`
    <div class="screen" id="lobby">
      ${renderRail(t("lobby"))}
      <main class="lobby-layout">
        <section class="room-hero" aria-labelledby="room-label">
          <div class="room-heading">
            <p class="eyebrow" id="room-label">${t("roomCode")}</p>
            <span class="live-mark"><i></i> LIVE ROOM</span>
          </div>
          <button id="copy" class="room-code" aria-label="${t("copyLink")}: ${room.code}">
            <span>${room.code}</span>
            <small>${t("copyLink")} <b aria-hidden="true">↗</b></small>
          </button>
          <p class="waiting-copy"><strong>${t("waiting")}</strong> ${t("waitingHint")}</p>
        </section>

        <section class="lobby-board">
          <div class="section-heading">
            <span>PLAYERS / ${room.players.length.toString().padStart(2, "0")}</span>
            <span>MAX 08</span>
          </div>
          <ul class="player-list">${players}</ul>
        </section>

        <aside class="rhythm-card" aria-labelledby="rhythm-title">
          <p class="eyebrow" id="rhythm-title">${t("howItWorks")}</p>
          <ol>
            <li><b>01</b><span>${t("see")}</span></li>
            <li><b>02</b><span>${t("count")}</span></li>
            <li><b>03</b><span>${t("commit")}</span></li>
          </ol>
        </aside>

        <section class="lobby-actions">
          <button id="cancel-room" class="cancel-action"><span aria-hidden="true">←</span> LEAVE ROOM</button>
          <button id="ready" class="${me?.ready ? "is-ready" : ""}">
            <span>${me?.ready ? "✓" : "○"}</span>
            ${me?.ready ? t("ready") : t("notReady")}
          </button>
          ${amHost ? `<button id="start" class="start-action">${t("start")} <span aria-hidden="true">→</span></button>` : ""}
        </section>
      </main>
    </div>
  `);
  app.append(el);
  wireRail(el);

  el.querySelector("#copy")!.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}?room=${room!.code}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(t("copied"));
    } catch {
      toast(url);
    }
  });
  el.querySelector("#ready")!.addEventListener("click", () => {
    sfx.unlock();
    net.send({ t: "ready", ready: !me?.ready });
  });
  el.querySelector("#start")?.addEventListener("click", () => {
    sfx.unlock();
    net.send({ t: "startMatch" });
  });
  el.querySelector("#cancel-room")!.addEventListener("click", () => {
    net.send({ t: "leave" });
    clearActiveSession();
    room = null;
    myId = "";
    history.replaceState(null, "", location.pathname);
    setScreen("home");
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderGame(): void {
  app.innerHTML = "";
  const canAnswer = room?.state === "ANSWER" && !ownLocked && !lockPending;
  const canEndMatch = room?.hostId === myId && room.state !== "LOBBY" && room.state !== "FINAL";
  const el = $(`
    <div class="screen game-screen">
      ${renderRail(t("game"))}
      <main class="game-layout">
        <section class="stage-zone" id="game-stage" aria-label="${t("question")}">
          <div class="stage-coordinates" aria-hidden="true"><span>A</span><span>B</span><span>C</span><span>D</span><span>E</span></div>
          <div class="game-hud">
            <div class="phase-meta">
              <span>${t("round")} ${room?.round ?? 0} / ${room?.rounds ?? 7}</span>
              <span>05 × 05 GRID</span>
            </div>
            <div class="phase-title" id="phase-title" aria-live="polite"></div>
            <div class="answer-timer hidden" id="answer-timer" role="timer" aria-live="off"><span>TIME</span><strong>00.0</strong></div>
            <div class="big-digit" id="big-digit" aria-live="polite"></div>
            <div class="flank left" id="flank-l"></div>
            <div class="flank right" id="flank-r"></div>
            <div class="reveal-roster" id="reveal-roster" aria-live="polite"></div>
            <div class="score-strip-slot" id="score-strip-slot"></div>
          </div>
        </section>

        <aside class="control-deck" aria-label="${t("yourCount")}">
          <div class="console-heading">
            <span>COUNT CONSOLE</span>
            <span class="key-hint">${t("pressKey")}</span>
          </div>
          <section class="opponent-panel" aria-label="${t("opponents")}">
            <p class="console-label">${t("opponents")}</p>
            <div class="opponents-row" id="opponents"></div>
          </section>
          <section class="own-panel">
            <p class="console-label">${t("yourCount")}</p>
            <div class="own-counter-wrap" id="own-wrap"></div>
          </section>
          <div class="control-btns">
            <button class="btn-minus" id="btn-minus" aria-label="Subtract one from your count" ${canAnswer ? "" : "disabled"}><small>− KEY</small><strong>${t("minusOne")}</strong></button>
            <button class="btn-plus" id="btn-plus" aria-label="Add one to your count" ${canAnswer ? "" : "disabled"}><small>SPACE</small><strong>${t("plusOne")}</strong></button>
            <button class="btn-lock" id="btn-lock" aria-label="Lock your answer" ${canAnswer ? "" : "disabled"}><small>ENTER</small><strong>${t("lock")}</strong></button>
          </div>
          ${room?.hostId === myId ? `<div class="round-admin"><button id="btn-end-match" aria-label="End the entire game now" ${canEndMatch ? "" : "disabled"}>END GAME</button></div>` : ""}
        </aside>
      </main>
    </div>
  `);
  app.append(el);
  wireRail(el);

  flip = new FlipCounter();
  flip.set(optimisticCount, false);
  el.querySelector("#own-wrap")!.append(flip.el);
  updateOpponents();
  ensureScene().resize();
  setPhaseTitle(phaseText, phaseDigit);

  const minus = el.querySelector("#btn-minus") as HTMLButtonElement;
  const plus = el.querySelector("#btn-plus") as HTMLButtonElement;
  const lockBtn = el.querySelector("#btn-lock") as HTMLButtonElement;

  const onAdjust = (delta: -1 | 1) => (e: Event) => {
    if (
      e instanceof PointerEvent &&
      (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0))
    ) {
      return;
    }
    e.preventDefault();
    if (ownLocked || lockPending || room?.state !== "ANSWER") return;
    sfx.press();
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
    sendAdjustment(delta);
  };

  minus.addEventListener("pointerdown", onAdjust(-1));
  plus.addEventListener("pointerdown", onAdjust(1));

  const onLock = (e: Event) => {
    e.preventDefault();
    if (ownLocked || lockPending || room?.state !== "ANSWER") return;
    if (Date.now() - answerStartedAt < LOCK_GUARD_MS) return;
    if (optimisticCount === 0 && !lockArmed) {
      lockArmed = true;
      lockBtn.classList.add("armed");
      lockBtn.textContent = t("sureZero");
      return;
    }
    sfx.lock();
    lockPending = true;
    minus.disabled = true;
    plus.disabled = true;
    lockBtn.disabled = true;
    net.send({ t: "lock" });
  };
  lockBtn.addEventListener("pointerdown", onLock);
  el.querySelector("#btn-end-match")?.addEventListener("click", () => {
    if (window.confirm("End the entire game now and show final results?")) {
      net.send({ t: "endMatch" });
    }
  });

  window.addEventListener("keydown", onKey);
}

function sendAdjustment(delta: -1 | 1): void {
  const seq = nextAdjustSeq++;
  pendingAdjustments.set(seq, delta);
  reconcileOptimistic();
  net.send({ t: "adjust", delta, seq });
}

function reconcileOptimistic(): void {
  let value = authoritativeCount;
  for (const delta of pendingAdjustments.values()) {
    value = Math.max(0, Math.min(99, value + delta));
  }
  optimisticCount = value;
  flip?.set(value);
}

function onKey(e: KeyboardEvent): void {
  if (screen !== "game") return;
  if (e.code === "Space") {
    e.preventDefault();
    document.getElementById("btn-plus")?.dispatchEvent(new Event("pointerdown"));
  }
  if (e.code === "Minus" || e.code === "NumpadSubtract" || e.code === "ArrowDown") {
    e.preventDefault();
    document.getElementById("btn-minus")?.dispatchEvent(new Event("pointerdown"));
  }
  if (e.code === "Enter") {
    e.preventDefault();
    document.getElementById("btn-lock")?.dispatchEvent(new Event("pointerdown"));
  }
}

function updateOpponents(results?: RoundResult[]): void {
  const row = document.getElementById("opponents");
  if (!row || !room) return;
  const opponents = room.players
    .filter((p) => p.id !== myId)
    .map((p) => {
      const result = results?.find((r) => r.playerId === p.id);
      const v = result?.value ?? counters.get(p.id) ?? 0;
      const isLocked = result !== undefined || locked.has(p.id);
      const shownValue = result ? String(v).padStart(2, "0") : "—";
      const status = result
        ? result.outcome === "exact"
          ? t("exact")
          : result.outcome === "closest"
            ? t("closest")
            : t("locked")
        : isLocked
          ? t("locked")
          : p.connected
            ? t("count")
            : t("offline");
      const classes = [
        "opponent-tile",
        isLocked ? "is-locked" : "",
        p.connected ? "" : "is-offline",
        result?.outcome === "exact" ? "is-exact" : "",
        result?.outcome === "closest" ? "is-closest" : "",
      ].filter(Boolean).join(" ");
      return `
        <article class="${classes}">
          <span class="opponent-marker">${escapeHtml(playerInitial(p.name))}</span>
          <span class="opponent-name">${escapeHtml(p.name)}</span>
          <strong>${shownValue}</strong>
          <small>${status}</small>
        </article>
      `;
    })
    .join("");
  row.innerHTML = opponents || `<p class="solo-opponent">SOLO / PRACTICE</p>`;
}

function setPhaseTitle(text: string, digit = ""): void {
  phaseText = text;
  phaseDigit = digit;
  const title = document.getElementById("phase-title");
  const dig = document.getElementById("big-digit");
  if (title) title.textContent = text;
  if (dig) dig.textContent = digit;
}

function renderFinal(): void {
  if (!room) return;
  const ranked = [...room.players].sort((a, b) => {
    const sa = lastScores.find((s) => s.playerId === a.id)?.score ?? a.score;
    const sb = lastScores.find((s) => s.playerId === b.id)?.score ?? b.score;
    return sb - sa;
  });
  const amHost = room.hostId === myId;
  const winNames = winnerIds
    .map((id) => room!.players.find((p) => p.id === id)?.name ?? id)
    .join(", ");
  const headline =
    winnerIds.length === 1
      ? t("winner", { name: winNames })
      : t("draw");

  app.innerHTML = "";
  const rows = ranked
    .map((p, i) => {
      const score =
        lastScores.find((s) => s.playerId === p.id)?.score ?? p.score;
      const outcomes = roundOutcomes.get(p.id) ?? p.outcomes;
      const sparks = outcomes
        .map((o) => `<i class="${o}"></i>`)
        .join("");
      return `
        <li class="${winnerIds.includes(p.id) ? "is-winner" : ""} ${p.connected ? "" : "is-offline"}">
          <span class="rank-number">${String(i + 1).padStart(2, "0")}</span>
          <span class="score-player">
            <span class="seat-marker" aria-hidden="true">${escapeHtml(playerInitial(p.name))}</span>
            <span><strong>${escapeHtml(p.name)}</strong><small>${[p.id === myId ? t("you") : "", p.connected ? "" : t("offline")].filter(Boolean).join(" · ")}</small></span>
          </span>
          <span class="spark" aria-label="${t("matchLedger")}">${sparks}</span>
          <strong class="score-total">${String(score).padStart(2, "0")}</strong>
        </li>
      `;
    })
    .join("");

  const el = $(`
    <div class="screen" id="final">
      ${renderRail(t("results"))}
      <main class="final-layout">
        <header class="winner-hero">
          <p class="eyebrow">MATCH COMPLETE · FINAL LEDGER</p>
          <div class="podium-mark" aria-hidden="true"><span>1</span></div>
          <h1 class="final-headline">${headline}</h1>
          <p>${room.round} ${t("round").toLowerCase()} · ${room.players.length.toString().padStart(2, "0")} ${t("player").toLowerCase()}</p>
        </header>

        <section class="ledger" aria-labelledby="ledger-title">
          <div class="section-heading" id="ledger-title">
            <span>${t("matchLedger")}</span>
            <span>YAMI CUBE RUSH / 01</span>
          </div>
          <div class="ledger-labels" aria-hidden="true">
            <span>${t("rank")}</span><span>${t("player")}</span><span>ROUNDS</span><span>${t("score")}</span>
          </div>
          <ol class="scoreboard">${rows}</ol>
        </section>

        <div class="final-actions">
          ${amHost ? `<button id="rematch" class="primary-action">${t("rematch")} <span aria-hidden="true">↻</span></button>` : ""}
          <button id="new" class="secondary">${t("newRoom")} <span aria-hidden="true">→</span></button>
        </div>
      </main>
    </div>
  `);
  app.append(el);
  wireRail(el);
  el.querySelector("#rematch")?.addEventListener("click", () => {
    net.send({ t: "rematch" });
  });
  el.querySelector("#new")!.addEventListener("click", () => {
    net.send({ t: "leave" });
    clearActiveSession();
    location.href = location.pathname;
  });
}

function render(): void {
  window.removeEventListener("keydown", onKey);
  if (screen === "home") renderHome();
  else if (screen === "lobby") renderLobby();
  else if (screen === "game") renderGame();
  else if (screen === "final") renderFinal();
}

/* ─── Phase scheduling ─── */

function scheduleFlash(): void {
  if (!pendingFlash || pendingFlash.grid.length === 0) return;
  const { flashAt, holdMs, grid, round } = pendingFlash;
  const localAt = clock.serverToLocal(flashAt);
  const version = phaseVersion;
  void (async () => {
    if (!(await waitUntil(localAt, version))) return;
    await fireFlash(grid, holdMs, round, localAt, version);
  })();
}

async function fireFlash(
  grid: Grid,
  holdMs: number,
  _round: number,
  localAt: number,
  version: number,
): Promise<void> {
  if (flashFired || version !== phaseVersion) return;
  flashFired = true;
  const skew = Date.now() - localAt;

  if (document.visibilityState === "hidden") {
    // Will check on visible
    return;
  }

  if (!syncSent) {
    syncSent = true;
    net.send({
      t: "sync",
      skew,
      rtt: clock.bestRtt === Infinity ? 0 : clock.bestRtt,
      offset: clock.offset,
    });
  }

  setPhaseTitle(t("remember"), "");
  const sc = ensureScene();
  await sc.animateSlideIn(grid);
  if (version !== phaseVersion || !(await sleep(holdMs, version))) return;
  await sc.animateVanish();
}

function sleep(ms: number, version = phaseVersion): Promise<boolean> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(version === phaseVersion), ms);
  });
}

let lastResumeAt = 0;
function resumeFromMobileSuspension(): void {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastResumeAt < 500) return;
  lastResumeAt = now;
  net.resume();
  if (pendingFlash && !flashFired) {
    const localAt = clock.serverToLocal(pendingFlash.flashAt);
    if (now > localAt + 600 + pendingFlash.holdMs) {
      flashFired = true;
      ensureScene().clearCubes();
      setPhaseTitle(t("missedFlash"), "");
    }
  }
}

document.addEventListener("visibilitychange", resumeFromMobileSuspension);
window.addEventListener("focus", resumeFromMobileSuspension);
window.addEventListener("pageshow", resumeFromMobileSuspension);
window.addEventListener("online", resumeFromMobileSuspension);

function cancelPhaseWork(): void {
  phaseVersion++;
  stopAnswerTimer();
  scene?.cancelAnims();
}

function resetRoundState(): void {
  ownLocked = false;
  lockPending = false;
  lockArmed = false;
  optimisticCount = 0;
  authoritativeCount = 0;
  nextAdjustSeq = 1;
  pendingAdjustments = new Map();
  counters = new Map();
  locked = new Set();
}

function beginRoundUi(
  msg: Extract<S2C, { t: "roundIntro" }>,
): void {
  cancelPhaseWork();
  resetRoundState();
  flashFired = false;
  pendingFlash = {
    grid: [],
    flashAt: msg.flashAt,
    holdMs: msg.holdMs,
    round: msg.round,
  };
  scene?.clearCubes();
  if (room) room = { ...room, state: "COUNTDOWN", round: msg.round };
  setScreen("game");
  setPhaseTitle(t("remember"), "");
  const version = phaseVersion;
  void runRememberCountdown(
    clock.serverToLocal(msg.countdownAt),
    clock.serverToLocal(msg.flashAt),
    version,
  );
}

function enterAnswerUi(
  answerEndsAt: number,
  states?: {
    playerId: string;
    value: number;
    locked: boolean;
    ackSeq: number;
  }[],
  serverNow?: number,
): void {
  cancelPhaseWork();
  scene?.clearCubes();
  pendingFlash = null;
  if (states) {
    counters = new Map(states.map((state) => [state.playerId, state.value]));
    locked = new Set(
      states.filter((state) => state.locked).map((state) => state.playerId),
    );
    const mine = states.find((state) => state.playerId === myId);
    authoritativeCount = mine?.value ?? 0;
    optimisticCount = authoritativeCount;
    ownLocked = mine?.locked ?? false;
    lockPending = false;
    pendingAdjustments.clear();
    nextAdjustSeq = (mine?.ackSeq ?? 0) + 1;
  }
  if (room) room = { ...room, state: "ANSWER" };
  answerStartedAt =
    serverNow === undefined ? Date.now() : Date.now() - LOCK_GUARD_MS;
  lockArmed = false;
  setScreen("game");
  flip?.set(optimisticCount, false);
  if (ownLocked) flip?.showLocked(authoritativeCount);
  setPhaseTitle(t("question"), "");
  startAnswerTimer(answerEndsAt, serverNow);
}

function stopAnswerTimer(): void {
  if (answerTimer) clearInterval(answerTimer);
  answerTimer = null;
  document.getElementById("answer-timer")?.classList.add("hidden");
}

function startAnswerTimer(answerEndsAt: number, serverNow?: number): void {
  stopAnswerTimer();
  const localEnd =
    serverNow === undefined
      ? clock.serverToLocal(answerEndsAt)
      : Date.now() + Math.max(0, answerEndsAt - serverNow);
  const update = () => {
    const el = document.getElementById("answer-timer");
    const value = el?.querySelector("strong");
    if (!el || !value) return;
    const remaining = Math.max(0, localEnd - Date.now());
    value.textContent = (remaining / 1000).toFixed(1).padStart(4, "0");
    el.classList.remove("hidden");
    el.setAttribute(
      "aria-label",
      `${Math.ceil(remaining / 1000)} seconds remaining`,
    );
    if (remaining <= 0 && answerTimer) {
      clearInterval(answerTimer);
      answerTimer = null;
    }
  };
  update();
  answerTimer = setInterval(update, 100);
}

function renderRevealSummary(results: RoundResult[]): void {
  const roster = document.getElementById("reveal-roster");
  if (!roster) return;
  roster.innerHTML = results
    .map((result) => {
      const player = room?.players.find((p) => p.id === result.playerId);
      const name = player?.name ?? result.playerId;
      return `
        <span class="${result.outcome} ${result.playerId === myId ? "is-you" : ""} ${result.connected ? "" : "is-offline"}">
          <small>${escapeHtml(name)}${result.connected ? "" : ` · ${t("offline")}`}</small>
          <strong>${result.value}</strong>
        </span>
      `;
    })
    .join("");
  roster.classList.add("visible");
}

function renderScoreStrip(scores: ScoreTotal[]): void {
  const slot = document.getElementById("score-strip-slot");
  if (!slot) return;
  slot.innerHTML = "";
  const strip = document.createElement("div");
  strip.className = "score-strip";
  strip.innerHTML = scores
    .map((score) => {
      const name =
        room?.players.find((p) => p.id === score.playerId)?.name ??
        score.playerId;
      return `<span class="${score.connected ? "" : "is-offline"}"><small>${escapeHtml(name)}${score.connected ? "" : ` · ${t("offline")}`}</small><strong>${String(score.score).padStart(2, "0")}</strong></span>`;
    })
    .join("");
  slot.append(strip);
}

function showRevealSnapshot(
  reveal: RevealState,
  phase: "REVEAL" | "INTERMISSION",
): void {
  cancelPhaseWork();
  lastScores = reveal.scores;
  if (room) room = { ...room, state: phase, round: reveal.round };
  setScreen("game");
  ensureScene().showReveal(reveal.grid);
  setPhaseTitle(
    phase === "REVEAL" ? t("question") : "",
    phase === "REVEAL" ? String(reveal.truth) : "",
  );
  renderRevealSummary(reveal.results);
  renderScoreStrip(reveal.scores);
  updateOpponents(reveal.results);
}

function applyPhaseSync(msg: PhaseSync): void {
  switch (msg.phase) {
    case "LOBBY":
      cancelPhaseWork();
      if (room) room = { ...room, state: "LOBBY" };
      setScreen("lobby");
      break;
    case "STARTING":
      cancelPhaseWork();
      if (room) room = { ...room, state: "STARTING" };
      setScreen("game");
      setPhaseTitle(t("getReady"), "");
      break;
    case "COUNTDOWN": {
      beginRoundUi({
        t: "roundIntro",
        round: msg.round,
        countdownAt: msg.countdownAt,
        flashAt: msg.flashAt,
        holdMs: msg.holdMs,
      });
      if (msg.flash && pendingFlash) {
        pendingFlash.grid = msg.flash.grid;
        scheduleFlash();
      }
      break;
    }
    case "FLASH": {
      cancelPhaseWork();
      resetRoundState();
      flashFired = true;
      pendingFlash = null;
      if (room) room = { ...room, state: "FLASH", round: msg.round };
      setScreen("game");
      const visibleUntil = msg.flashAt + 600 + msg.holdMs;
      if (msg.serverNow < visibleUntil) ensureScene().setGrid(msg.grid, true);
      else ensureScene().clearCubes();
      setPhaseTitle(t("remember"), "");
      break;
    }
    case "ANSWER":
      enterAnswerUi(msg.answerEndsAt, msg.counters, msg.serverNow);
      break;
    case "REVEAL":
      showRevealSnapshot(msg.reveal, "REVEAL");
      break;
    case "INTERMISSION":
      showRevealSnapshot(msg.reveal, "INTERMISSION");
      break;
    case "FINAL":
      cancelPhaseWork();
      lastScores = msg.scores;
      winnerIds = msg.winnerIds;
      if (room) {
        room = { ...room, state: "FINAL" };
        for (const score of msg.scores) {
          const player = room.players.find((p) => p.id === score.playerId);
          if (player) {
            player.score = score.score;
            player.connected = score.connected;
          }
        }
      }
      setScreen("final");
      break;
  }
}

/* ─── Net handlers ─── */

net.onStatus = (s) => {
  if (s === "reconnecting") toast(t("reconnecting"));
};

const deepRoom = new URLSearchParams(location.search).get("room");
net.onOpen = (reconnected) => {
  void clock.burst();
  const active = getActiveSession();
  if (active && (!deepRoom || deepRoom === active.code)) {
    net.send({
      t: "joinRoom",
      code: active.code,
      name: active.name,
      playerToken: active.token,
    });
    if (reconnected) toast(t("reconnected"));
  }
};

net.onMessage((msg: S2C) => {
  switch (msg.t) {
    case "welcome":
      myId = msg.playerId;
      room = msg.room;
      storeActiveSession({
        code: room.code,
        name: room.players.find((p) => p.id === myId)?.name ?? nameDefault(),
        token: msg.playerToken,
      });
      if (room.state === "LOBBY" || room.state === "FINAL") {
        setScreen(room.state === "FINAL" ? "final" : "lobby");
      } else {
        setScreen("game");
      }
      if (pendingPractice && room.state === "LOBBY" && room.hostId === myId) {
        pendingPractice = false;
        setTimeout(() => net.send({ t: "startMatch" }), 200);
      }
      break;

    case "roomUpdate":
      room = msg.room;
      if (screen === "lobby" || room.state === "LOBBY") {
        if (room.state === "LOBBY") setScreen("lobby");
        else render();
      }
      if (screen === "game") updateOpponents();
      break;

    case "matchStart":
      cancelPhaseWork();
      syncSent = false;
      roundOutcomes = new Map();
      if (room) room = { ...room, state: "STARTING" };
      setScreen("game");
      setPhaseTitle(t("getReady"), "");
      break;

    case "roundIntro":
      beginRoundUi(msg);
      break;

    case "flashData":
      if (pendingFlash && pendingFlash.round === msg.round) {
        pendingFlash.grid = msg.grid;
        scheduleFlash();
      }
      break;

    case "answerOpen":
      enterAnswerUi(msg.answerEndsAt);
      break;

    case "counter":
      counters.set(msg.playerId, msg.value);
      if (msg.playerId === myId) {
        authoritativeCount = msg.value;
        for (const seq of pendingAdjustments.keys()) {
          if (seq <= msg.ackSeq) pendingAdjustments.delete(seq);
        }
        nextAdjustSeq = Math.max(nextAdjustSeq, msg.ackSeq + 1);
        reconcileOptimistic();
        if (ownLocked) flip?.showLocked(authoritativeCount);
      }
      updateOpponents();
      break;

    case "locked":
      locked.add(msg.playerId);
      if (msg.playerId === myId) {
        ownLocked = true;
        lockPending = false;
        pendingAdjustments.clear();
        optimisticCount = authoritativeCount;
        flip?.showLocked(authoritativeCount);
      }
      updateOpponents();
      break;

    case "reveal":
      void handleReveal(msg);
      break;

    case "matchEnd":
      cancelPhaseWork();
      lastScores = msg.scores;
      winnerIds = msg.winnerIds;
      for (const s of msg.scores) {
        const p = room?.players.find((x) => x.id === s.playerId);
        if (p) {
          p.score = s.score;
          p.connected = s.connected;
        }
      }
      void (async () => {
        await showIris(t("theEnd"));
        sfx.win();
        confettiBurst();
        if (room) room = { ...room, state: "FINAL" };
        setScreen("final");
      })();
      break;

    case "phaseSync":
      applyPhaseSync(msg);
      break;

    case "error":
      if (
        msg.code === "ROOM_NOT_FOUND" ||
        msg.code === "SEAT_EXPIRED" ||
        msg.code === "SERVER_RESTART"
      ) {
        clearActiveSession();
        toast(msg.msg);
        setScreen("home");
      } else {
        toast(msg.msg);
      }
      break;

    default:
      break;
  }
});

async function runRememberCountdown(
  countdownAt: number,
  flashAt: number,
  version = phaseVersion,
): Promise<void> {
  for (let i = 3; i >= 1; i--) {
    const at = countdownAt + (3 - i) * 1000;
    if (at >= flashAt) break;
    if (Date.now() > at + 250) continue;
    if (!(await waitUntil(at, version))) return;
    sfx.countdown();
    setPhaseTitle(t("remember"), String(i));
  }
  if (!(await waitUntil(flashAt, version))) return;
  setPhaseTitle(t("remember"), "");
}

function waitUntil(localTs: number, version = phaseVersion): Promise<boolean> {
  return new Promise((resolve) => {
    const wake = Math.max(0, localTs - Date.now() - 50);
    setTimeout(() => {
      const gate = () => {
        if (version !== phaseVersion) {
          resolve(false);
          return;
        }
        if (Date.now() >= localTs) {
          resolve(true);
          return;
        }
        requestAnimationFrame(gate);
      };
      requestAnimationFrame(gate);
    }, wake);
  });
}

async function handleReveal(
  msg: Extract<S2C, { t: "reveal" }>,
): Promise<void> {
  cancelPhaseWork();
  const version = phaseVersion;
  if (room) room = { ...room, state: "REVEAL", round: msg.round };
  setScreen("game");
  lastScores = msg.scores;
  for (const r of msg.results) {
    const arr = roundOutcomes.get(r.playerId) ?? [];
    arr.push(r.outcome);
    roundOutcomes.set(r.playerId, arr);
    const player = room?.players.find((p) => p.id === r.playerId);
    if (player) {
      player.connected = r.connected;
      player.score =
        msg.scores.find((score) => score.playerId === r.playerId)?.score ??
        player.score;
    }
  }

  // Flank answers
  const others = msg.results.filter((r) => r.playerId !== myId);
  const mine = msg.results.find((r) => r.playerId === myId);
  const fl = document.getElementById("flank-l");
  const fr = document.getElementById("flank-r");
  if (fl && mine) {
    fl.textContent = String(mine.value);
    fl.classList.add("visible");
  }
  if (fr && others[0]) {
    fr.textContent = String(others[0].value);
    fr.classList.add("visible");
  }
  const roster = document.getElementById("reveal-roster");
  if (roster) {
    roster.innerHTML = msg.results
      .map((result) => {
        const player = room?.players.find((p) => p.id === result.playerId);
        const name = player?.name ?? result.playerId;
        return `
          <span class="${result.outcome} ${result.playerId === myId ? "is-you" : ""} ${result.connected ? "" : "is-offline"}">
            <small>${escapeHtml(name)}${result.connected ? "" : ` · ${t("offline")}`}</small>
            <strong>${result.value}</strong>
          </span>
        `;
      })
      .join("");
    roster.classList.add("visible");
  }

  setPhaseTitle(t("question"), "0");
  answerStartedAt = 0;
  updateOpponents(msg.results);

  const sc = ensureScene();
  await sc.animateReveal(msg.grid, msg.order, (filled) => {
    if (version !== phaseVersion) return;
    sfx.reveal();
    setPhaseTitle(t("question"), String(filled));
  });
  if (version !== phaseVersion) return;

  // Show outcome toast for self
  if (mine) {
    if (mine.outcome === "exact") toast(t("exact"));
    else if (mine.outcome === "closest") toast(t("closest"));
  }

  if (!(await sleep(1500, version))) return;
  fl?.classList.remove("visible");
  fr?.classList.remove("visible");
  roster?.classList.remove("visible");

  // Intermission score strip
  setPhaseTitle("", "");
  const strip = document.createElement("div");
  strip.className = "score-strip";
  strip.innerHTML = msg.scores
    .map((s) => {
      const name = room?.players.find((p) => p.id === s.playerId)?.name ?? s.playerId;
      return `<span><small>${escapeHtml(name)}</small><strong>${String(s.score).padStart(2, "0")}</strong></span>`;
    })
    .join("");
  document.getElementById("score-strip-slot")?.append(strip);
  if (!(await sleep(2000, version))) return;
  strip.remove();

  // Prepare answer UI for next round handled by roundIntro
  // Enter ANSWER is server-driven via phase — actually ANSWER comes BEFORE reveal.
  // After reveal we wait for next roundIntro or matchEnd.
}

/* ─── Boot ─── */

net.connect();
clock.start();
setScreen("home");
