import type { WebSocket } from "ws";
import { HEARTBEAT_PING_MS, HEARTBEAT_TIMEOUT_MS } from "@pacecubs/shared";

export interface HeartbeatSocket {
  ws: WebSocket;
  lastPong: number;
  isAlive: boolean;
}

/**
 * App-level ping every 15s; terminate if no pong within 30s (BRD §7.4).
 */
export function startHeartbeat(
  getSockets: () => Iterable<HeartbeatSocket>,
  onDead: (sock: HeartbeatSocket) => void,
): () => void {
  const interval = setInterval(() => {
    const now = Date.now();
    for (const sock of getSockets()) {
      if (now - sock.lastPong > HEARTBEAT_TIMEOUT_MS) {
        onDead(sock);
        try {
          sock.ws.terminate();
        } catch {
          /* ignore */
        }
        continue;
      }
      if (sock.ws.readyState === sock.ws.OPEN) {
        sock.ws.send(JSON.stringify({ t: "ping" }));
      }
    }
  }, HEARTBEAT_PING_MS);

  return () => clearInterval(interval);
}
