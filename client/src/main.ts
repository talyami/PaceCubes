import type {
  Grid,
  RoomSnapshot,
  RoundResult,
  S2C,
} from "@pacecubs/shared";
import { LOCK_GUARD_MS } from "@pacecubs/shared";
import { ClockSync } from "./clockSync.js";
import { getStoredToken, Net, storeToken } from "./net.js";
import { GameScene } from "./scene/renderer.js";
import { FlipCounter } from "./ui/counter.js";
import { getLang, loadLang, setLang, t } from "./ui/i18n.js";
import { isMuted, loadMute, setMuted, sfx } from "./ui/sfx.js";

type Screen = "home" | "lobby" | "game" | "final";

const app = document.getElementById("app")!;
const canvas = document.getElementById("canvas") as HTMLCanvasElement;

const net = new Net();
const clock = new ClockSync(net);
let scene: GameScene | null = null;

let screen: Screen = "home";
let myId = "";
let myToken = "";
let room: RoomSnapshot | null = null;
let counters = new Map<string, number>();
let locked = new Set<string>();
let ownLocked = false;
let answerStartedAt = 0;
let lockArmed = false;
let pendingFlash: { grid: Grid; flashAt: number; holdMs: number; round: number } | null = null;
let flashFired = false;
let syncSent = false;
let lastResults: RoundResult[] = [];
let lastScores: { playerId: string; score: number }[] = [];
let winnerIds: string[] = [];
let roundOutcomes = new Map<string, ("exact" | "closest" | "none")[]>();
let optimisticCount = 0;
let flip: FlipCounter | null = null;
let irisEl: HTMLElement | null = null;
let phaseText = "";
let phaseDigit = "";

loadLang();
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
  const colors = ["#34d434", "#222222", "#c8c8c8", "#f4f4f8"];
  for (let i = 0; i < 40; i++) {
    const s = document.createElement("span");
    s.style.left = `${Math.random() * 100}%`;
    s.style.background = colors[i % colors.length]!;
    s.style.animationDelay = `${Math.random() * 0.3}s`;
    s.style.animationDuration = `${0.8 + Math.random() * 0.4}s`;
    layer.append(s);
  }
  setTimeout(() => layer.remove(), 1200);
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
    return localStorage.getItem("pacecubs.name") ?? "";
  } catch {
    return "";
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem("pacecubs.name", n);
  } catch {
    /* ignore */
  }
}

/* ─── Screens ─── */

function renderRail(section: string): string {
  return `
    <header class="app-rail">
      <div class="rail-brand" aria-label="Pace Cubs">
        <span class="mini-cube" aria-hidden="true"></span>
        <strong>PACE CUBS</strong>
      </div>
      <span class="rail-section">${section}</span>
      <div class="rail-tools">
        <button id="lang" class="rail-button ${getLang() === "zh-CN" ? "active" : ""}" aria-label="Change language">${getLang() === "zh-CN" ? "中文" : "EN"}</button>
        <button id="mute" class="rail-button" aria-label="${isMuted() ? t("soundOff") : t("soundOn")}" aria-pressed="${isMuted()}">${isMuted() ? "SND OFF" : "SND ON"}</button>
      </div>
    </header>
  `;
}

function wireRail(el: HTMLElement): void {
  el.querySelector("#lang")?.addEventListener("click", () => {
    setLang(getLang() === "en" ? "zh-CN" : "en");
    render();
  });
  el.querySelector("#mute")?.addEventListener("click", () => {
    setMuted(!isMuted());
    render();
  });
}

function renderHome(): void {
  const urlRoom = new URLSearchParams(location.search).get("room") ?? "";
  app.innerHTML = "";
  const el = $(`
    <div class="screen" id="home">
      ${renderRail(t("home"))}
      <main class="home-layout">
        <section class="home-hero" aria-labelledby="home-title">
          <p class="eyebrow">MULTIPLAYER COUNTING LAB · 01</p>
          <h1 class="brand brand-stack" id="home-title"><span>PACE</span><span>CUBS</span></h1>
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
              <input id="code" maxlength="4" value="${escapeHtml(urlRoom)}" autocomplete="off" autocapitalize="characters" />
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
      net.send({ t: "createRoom", name: getName(), lang: getLang() });
    }),
  );
  el.querySelector("#btn-join")!.addEventListener("click", () =>
    go(() => {
      const code = (el.querySelector("#code") as HTMLInputElement).value
        .trim()
        .toUpperCase();
      net.send({
        t: "joinRoom",
        code,
        name: getName(),
        playerToken: getStoredToken() ?? undefined,
      });
    }),
  );
  el.querySelector("#btn-practice")!.addEventListener("click", () =>
    go(() => {
      net.send({ t: "createRoom", name: getName(), lang: getLang() });
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
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function renderGame(): void {
  app.innerHTML = "";
  const canAnswer = room?.state === "ANSWER" && !ownLocked;
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
            <button class="btn-plus" id="btn-plus" ${canAnswer ? "" : "disabled"}><small>TAP / SPACE</small><strong>${t("plusOne")}</strong></button>
            <button class="btn-lock" id="btn-lock" ${canAnswer ? "" : "disabled"}><small>COMMIT</small><strong>${t("lock")}</strong></button>
          </div>
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

  const plus = el.querySelector("#btn-plus") as HTMLButtonElement;
  const lockBtn = el.querySelector("#btn-lock") as HTMLButtonElement;

  const onPress = (e: Event) => {
    e.preventDefault();
    if (ownLocked || room?.state !== "ANSWER") return;
    sfx.press();
    try {
      navigator.vibrate?.(10);
    } catch {
      /* ignore */
    }
    optimisticCount = Math.min(99, optimisticCount + 1);
    flip?.set(optimisticCount);
    net.send({ t: "press" });
  };

  plus.addEventListener("pointerdown", onPress);
  plus.addEventListener("touchstart", onPress, { passive: false });

  const onLock = (e: Event) => {
    e.preventDefault();
    if (ownLocked || room?.state !== "ANSWER") return;
    if (Date.now() - answerStartedAt < LOCK_GUARD_MS) return;
    if (optimisticCount === 0 && !lockArmed) {
      lockArmed = true;
      lockBtn.classList.add("armed");
      lockBtn.textContent = t("sureZero");
      return;
    }
    sfx.lock();
    ownLocked = true;
    flip?.showLocked(optimisticCount);
    plus.disabled = true;
    lockBtn.disabled = true;
    net.send({ t: "lock" });
  };
  lockBtn.addEventListener("pointerdown", onLock);

  window.addEventListener("keydown", onKey);
}

function onKey(e: KeyboardEvent): void {
  if (screen !== "game") return;
  if (e.code === "Space") {
    e.preventDefault();
    document.getElementById("btn-plus")?.dispatchEvent(new Event("pointerdown"));
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
      const shownValue =
        room!.hideOpponentCount && !isLocked && !result ? "?" : String(v).padStart(2, "0");
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
      const outcomes = roundOutcomes.get(p.id) ?? [];
      const sparks = outcomes
        .map((o) => `<i class="${o}"></i>`)
        .join("");
      return `
        <li class="${winnerIds.includes(p.id) ? "is-winner" : ""}">
          <span class="rank-number">${String(i + 1).padStart(2, "0")}</span>
          <span class="score-player">
            <span class="seat-marker" aria-hidden="true">${escapeHtml(playerInitial(p.name))}</span>
            <span><strong>${escapeHtml(p.name)}</strong><small>${p.id === myId ? t("you") : ""}</small></span>
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
            <span>PACE CUBS / 01</span>
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
  if (!pendingFlash) return;
  const { flashAt, holdMs, grid, round } = pendingFlash;
  const localAt = clock.serverToLocal(flashAt);

  const wake = Math.max(0, localAt - Date.now() - 250);
  setTimeout(() => {
    const gate = () => {
      if (flashFired) return;
      if (Date.now() >= localAt) {
        void fireFlash(grid, holdMs, round, localAt);
        return;
      }
      requestAnimationFrame(gate);
    };
    requestAnimationFrame(gate);
  }, wake);
}

async function fireFlash(
  grid: Grid,
  holdMs: number,
  _round: number,
  localAt: number,
): Promise<void> {
  if (flashFired) return;
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
  await sleep(holdMs);
  await sc.animateVanish();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !pendingFlash || flashFired)
    return;
  const localAt = clock.serverToLocal(pendingFlash.flashAt);
  if (Date.now() > localAt + pendingFlash.holdMs) {
    flashFired = true;
    setPhaseTitle(t("missedFlash"), "");
  }
});

/* ─── Net handlers ─── */

net.onStatus = (s) => {
  if (s === "reconnecting") toast(t("reconnecting"));
};

net.onMessage((msg: S2C) => {
  switch (msg.t) {
    case "welcome":
      myId = msg.playerId;
      myToken = msg.playerToken;
      storeToken(myToken);
      room = msg.room;
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
      syncSent = false;
      roundOutcomes = new Map();
      setScreen("game");
      setPhaseTitle(t("intro"), "");
      // Intro countdown digits driven by introAt
      void runIntroCountdown(clock.serverToLocal(msg.introAt));
      break;

    case "roundIntro":
      flashFired = false;
      ownLocked = false;
      lockArmed = false;
      optimisticCount = 0;
      counters = new Map();
      locked = new Set();
      pendingFlash = {
        grid: [], // filled by flashData
        flashAt: msg.flashAt,
        holdMs: msg.holdMs,
        round: msg.round,
      };
      if (room) room = { ...room, state: "COUNTDOWN", round: msg.round };
      setScreen("game");
      flip?.resetFlip();
      void runRememberCountdown(
        clock.serverToLocal(msg.countdownAt),
        clock.serverToLocal(msg.flashAt),
      );
      break;

    case "flashData":
      if (pendingFlash && pendingFlash.round === msg.round) {
        pendingFlash.grid = msg.grid;
        scheduleFlash();
        armAnswerPhase();
      }
      break;

    case "counter":
      counters.set(msg.playerId, msg.value);
      if (msg.playerId === myId && !ownLocked) {
        // Reconcile optimistic
        if (msg.value > optimisticCount) {
          optimisticCount = msg.value;
          flip?.set(optimisticCount);
        }
      }
      updateOpponents();
      break;

    case "locked":
      locked.add(msg.playerId);
      if (msg.playerId === myId) {
        ownLocked = true;
        flip?.showLocked(optimisticCount);
      }
      updateOpponents();
      break;

    case "reveal":
      void handleReveal(msg);
      break;

    case "matchEnd":
      lastScores = msg.scores;
      winnerIds = msg.winnerIds;
      for (const s of msg.scores) {
        const p = room?.players.find((x) => x.id === s.playerId);
        if (p) p.score = s.score;
      }
      void (async () => {
        await showIris(t("theEnd"));
        sfx.win();
        confettiBurst();
        if (room) room = { ...room, state: "FINAL" };
        setScreen("final");
      })();
      break;

    case "error":
      if (msg.code === "ROOM_NOT_FOUND" || msg.code === "SERVER_RESTART") {
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

async function runIntroCountdown(localIntroAt: number): Promise<void> {
  for (let i = 3; i >= 1; i--) {
    const at = localIntroAt + (3 - i) * 1000;
    await waitUntil(at);
    sfx.countdown();
    setPhaseTitle(t("intro"), String(i));
  }
}

async function runRememberCountdown(
  countdownAt: number,
  flashAt: number,
): Promise<void> {
  for (let i = 3; i >= 1; i--) {
    const at = countdownAt + (3 - i) * 1000;
    if (at >= flashAt) break;
    await waitUntil(at);
    sfx.countdown();
    setPhaseTitle(t("remember"), String(i));
  }
  // Clear digit at flash
  await waitUntil(flashAt);
  setPhaseTitle(t("remember"), "");
}

function waitUntil(localTs: number): Promise<void> {
  return new Promise((resolve) => {
    const wake = Math.max(0, localTs - Date.now() - 50);
    setTimeout(() => {
      const gate = () => {
        if (Date.now() >= localTs) {
          resolve();
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
  lastResults = msg.results;
  lastScores = msg.scores;
  for (const r of msg.results) {
    const arr = roundOutcomes.get(r.playerId) ?? [];
    arr.push(r.outcome);
    roundOutcomes.set(r.playerId, arr);
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
          <span class="${result.outcome} ${result.playerId === myId ? "is-you" : ""}">
            <small>${escapeHtml(name)}</small>
            <strong>${result.value}</strong>
          </span>
        `;
      })
      .join("");
    roster.classList.add("visible");
  }

  setPhaseTitle(t("question"), "0");
  answerStartedAt = 0;
  if (room) room = { ...room, state: "REVEAL" };
  updateOpponents(msg.results);

  const sc = ensureScene();
  await sc.animateReveal(msg.grid, msg.order, (filled) => {
    sfx.reveal();
    setPhaseTitle(t("question"), String(filled));
  });

  // Show outcome toast for self
  if (mine) {
    if (mine.outcome === "exact") toast(t("exact"));
    else if (mine.outcome === "closest") toast(t("closest"));
  }

  await sleep(1500);
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
  await sleep(2000);
  strip.remove();

  // Prepare answer UI for next round handled by roundIntro
  // Enter ANSWER is server-driven via phase — actually ANSWER comes BEFORE reveal.
  // After reveal we wait for next roundIntro or matchEnd.
}

// When entering ANSWER — server doesn't send a dedicated message; client infers
// from vanishing / or we watch room state. Better: after flash vanish locally,
// enable answer. Server enters ANSWER at same absolute time.
// Patch: listen for first moment after flash — use pendingFlash timing.

function armAnswerPhase(): void {
  if (!pendingFlash) return;
  const localFlash = clock.serverToLocal(pendingFlash.flashAt);
  const answerAt = localFlash + 600 + pendingFlash.holdMs + 250;
  void (async () => {
    await waitUntil(answerAt);
    if (room) room = { ...room, state: "ANSWER" };
    answerStartedAt = Date.now();
    lockArmed = false;
    ownLocked = false;
    optimisticCount = 0;
    flip?.resetFlip();
    setPhaseTitle(t("question"), "");
    const plus = document.getElementById("btn-plus") as HTMLButtonElement | null;
    const lockBtn = document.getElementById("btn-lock") as HTMLButtonElement | null;
    if (plus) plus.disabled = false;
    if (lockBtn) {
      lockBtn.disabled = false;
      lockBtn.classList.remove("armed");
      lockBtn.textContent = t("lock");
    }
  })();
}

/* ─── Boot ─── */

net.connect();
clock.start();
setScreen("home");

// Auto-join deep link once connected
const deepRoom = new URLSearchParams(location.search).get("room");
if (deepRoom) {
  // User still needs to enter name and click join — pre-filled
}
