import type { C2S, S2C } from "@yamicuberush/shared";

export type MsgHandler = (msg: S2C) => void;

function wsUrl(): string {
  const params = new URLSearchParams(location.search);
  const override = params.get("ws");
  if (override) return override;

  // Dev: page on :5173, server on :8081
  if (location.port === "5173") {
    return `ws://${location.hostname}:8081/ws`;
  }

  // The production WebSocket has its own origin because the site's
  // OpenLiteSpeed path proxy does not reliably preserve upgrades.
  if (location.hostname === "villa.linkflow.page") {
    return "wss://pacecubs-ws.icreditdept.online/ws";
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const portInfo = location.port ? `:${location.port}` : "";
  const path = location.pathname.startsWith("/yamicuberush")
    ? "/yamicuberush/ws"
    : "/ws";
  return `${proto}//${location.hostname}${portInfo}${path}`;
}

const TOKEN_KEY = "yamicuberush.token";
const ACTIVE_KEY = "yamicuberush.activeRoom";

export interface ActiveSession {
  code: string;
  name: string;
  token: string;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

export function getActiveSession(): ActiveSession | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_KEY) ?? "null") as
      | ActiveSession
      | null;
    if (
      parsed &&
      /^\d{2}$/.test(parsed.code) &&
      typeof parsed.name === "string" &&
      parsed.name.length > 0 &&
      typeof parsed.token === "string" &&
      parsed.token.length > 0
    ) {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function storeActiveSession(session: ActiveSession): void {
  try {
    localStorage.setItem(ACTIVE_KEY, JSON.stringify(session));
    storeToken(session.token);
  } catch {
    /* ignore */
  }
}

export function clearActiveSession(): void {
  try {
    localStorage.removeItem(ACTIVE_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<MsgHandler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private lastPingAt = Date.now();
  private hasOpened = false;
  private pingWatch: ReturnType<typeof setInterval> | null = null;
  onStatus?: (s: "connected" | "reconnecting" | "closed") => void;
  onOpen?: (reconnected: boolean) => void;

  connect(): void {
    this.intentionalClose = false;
    this.open();
  }

  private open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const url = wsUrl();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      const reconnected = this.hasOpened;
      this.hasOpened = true;
      this.reconnectAttempt = 0;
      this.lastPingAt = Date.now();
      this.onStatus?.("connected");
      this.onOpen?.(reconnected);
      this.startPingWatch();
    };

    ws.onmessage = (ev) => {
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      this.lastPingAt = Date.now();
      if (msg.t === "ping") {
        this.lastPingAt = Date.now();
        this.send({ t: "pong" });
        return;
      }
      for (const h of this.handlers) h(msg);
    };

    ws.onclose = () => {
      if (this.ws === ws) this.ws = null;
      this.stopPingWatch();
      if (this.intentionalClose) {
        this.onStatus?.("closed");
        return;
      }
      this.onStatus?.("reconnecting");
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      /* onclose handles */
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(10_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private startPingWatch(): void {
    this.stopPingWatch();
    this.pingWatch = setInterval(() => {
      if (Date.now() - this.lastPingAt > 30_000) {
        this.ws?.close();
      }
    }, 5_000);
  }

  private stopPingWatch(): void {
    if (this.pingWatch) clearInterval(this.pingWatch);
    this.pingWatch = null;
  }

  onMessage(h: MsgHandler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  send(msg: C2S): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.stopPingWatch();
    this.ws?.close();
  }

  resume(): void {
    this.intentionalClose = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Mobile browsers frequently preserve a zombie OPEN socket while the app is
    // backgrounded. Always replace it when the page becomes active; the server
    // uses the saved player token to atomically reclaim the seat.
    const stale = this.ws;
    this.ws = null;
    this.stopPingWatch();
    if (stale && stale.readyState !== WebSocket.CLOSED) {
      stale.onclose = null;
      stale.onerror = null;
      stale.onmessage = null;
      stale.close();
    }
    this.onStatus?.("reconnecting");
    this.open();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
