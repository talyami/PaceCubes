import type { C2S, S2C } from "@pacecubs/shared";

export type MsgHandler = (msg: S2C) => void;

function wsUrl(): string {
  const params = new URLSearchParams(location.search);
  const override = params.get("ws");
  if (override) return override;

  // Dev: page on :5173, server on :8081
  if (location.port === "5173") {
    return `ws://${location.hostname}:8081/ws`;
  }

  if (location.hostname === "villa.linkflow.page") {
    return "wss://pacecubs-ws.icreditdept.online/ws";
  }

  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const portInfo = location.port ? `:${location.port}` : "";
  return `${proto}//${location.hostname}${portInfo}/ws`;
}

const TOKEN_KEY = "pacecubs.token";

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

export class Net {
  private ws: WebSocket | null = null;
  private handlers = new Set<MsgHandler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private lastPingAt = Date.now();
  private pingWatch: ReturnType<typeof setInterval> | null = null;
  onStatus?: (s: "connected" | "reconnecting" | "closed") => void;

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
      this.reconnectAttempt = 0;
      this.lastPingAt = Date.now();
      this.onStatus?.("connected");
      this.startPingWatch();
    };

    ws.onmessage = (ev) => {
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      if (msg.t === "ping") {
        this.lastPingAt = Date.now();
        this.send({ t: "pong" });
        return;
      }
      for (const h of this.handlers) h(msg);
    };

    ws.onclose = () => {
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

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
