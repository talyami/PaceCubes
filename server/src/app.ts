import https from "node:https";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import {
  VERSION,
  type C2S,
  type S2C,
} from "@yamicuberush/shared";
import { Analytics } from "./analytics.js";
import { startHeartbeat } from "./heartbeat.js";
import { log } from "./log.js";
import { sanitizeName } from "./player.js";
import { RoomManager } from "./roomManager.js";

export interface AppOptions {
  port?: number;
  host?: string;
  maxRooms?: number;
  maxSockets?: number;
  originAllow?: string[];
  analyticsUrl?: string;
  publicDir?: string;
}

export interface App {
  server: https.Server | http.Server;
  rooms: RoomManager;
  wss: WebSocketServer;
  close: () => Promise<void>;
  port: number;
}

export async function createApp(opts: AppOptions = {}): Promise<App> {
  const PORT = opts.port ?? Number(process.env.PORT ?? 8081);
  const HOST = opts.host ?? process.env.HOST ?? "127.0.0.1";
  const MAX_ROOMS = opts.maxRooms ?? Number(process.env.MAX_ROOMS ?? 200);
  const MAX_SOCKETS = opts.maxSockets ?? Number(process.env.MAX_SOCKETS ?? 600);
  const ORIGIN_ALLOW =
    opts.originAllow ??
    (process.env.ORIGIN_ALLOW ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  const startedAt = Date.now();
  const analytics = new Analytics(opts.analyticsUrl);
  const rooms = new RoomManager(analytics, MAX_ROOMS);

  interface SockMeta {
    ws: WebSocket;
    lastPong: number;
    isAlive: boolean;
    strikes: number;
    ip: string;
  }

  const sockets = new Set<SockMeta>();

  const clientIp = (req: http.IncomingMessage): string => {
    const xf = req.headers["x-forwarded-for"];
    if (typeof xf === "string" && xf.length) return xf.split(",")[0]!.trim();
    return req.socket.remoteAddress ?? "unknown";
  };

  function checkOrigin(origin: string | undefined): boolean {
    if (ORIGIN_ALLOW.length === 0) {
      if (origin) log.debug("origin (allow-all)", { origin });
      return true;
    }
    if (!origin) return false;
    return ORIGIN_ALLOW.includes(origin);
  }

  function send(ws: WebSocket, msg: S2C): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  const publicDir =
    opts.publicDir ??
    process.env.PUBLIC_DIR ??
    path.join(process.cwd(), "public");

  const mime: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
  };

  const cb = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const urlPath = (req.url ?? "/").split("?")[0] || "/";
    if (urlPath === "/healthz") {
      const body = JSON.stringify({
        ok: true,
        uptimeS: Math.floor((Date.now() - startedAt) / 1000),
        rooms: rooms.rooms.size,
        sockets: rooms.socketCount(),
        version: VERSION,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
      return;
    }

    if (fs.existsSync(publicDir)) {
      let rel = urlPath === "/" ? "/index.html" : urlPath;
      if (rel.includes("..")) {
        res.writeHead(400);
        res.end("bad path");
        return;
      }
      const filePath = path.join(publicDir, rel);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath);
        res.writeHead(200, {
          "content-type": mime[ext] ?? "application/octet-stream",
          "cache-control":
            ext === ".html" ? "no-cache" : "public, max-age=3600",
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      const index = path.join(publicDir, "index.html");
      if (fs.existsSync(index)) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        fs.createReadStream(index).pipe(res);
        return;
      }
    }

    res.writeHead(404);
    res.end("not found");
  };

  const keyPath = process.env.SSL_KEY;
  const certPath = process.env.SSL_CERT;
  let server: https.Server | http.Server;
  
  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    server = https.createServer({
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    }, cb);
  } else {
    server = http.createServer(cb);
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname !== "/ws" && !url.pathname.endsWith("/ws")) {
      socket.destroy();
      return;
    }
    const origin = req.headers.origin;
    if (!checkOrigin(typeof origin === "string" ? origin : undefined)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    if (rooms.socketCount() >= MAX_SOCKETS) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket, req: http.IncomingMessage) => {
    const meta: SockMeta = {
      ws,
      lastPong: Date.now(),
      isAlive: true,
      strikes: 0,
      ip: clientIp(req),
    };
    sockets.add(meta);

    ws.on("message", (data) => {
      let msg: C2S;
      try {
        msg = JSON.parse(data.toString()) as C2S;
      } catch {
        meta.strikes++;
        send(ws, { t: "error", code: "BAD_MESSAGE", msg: "Malformed JSON" });
        if (meta.strikes >= 3) ws.close(1008, "bad message");
        return;
      }

      if (!msg || typeof msg !== "object" || typeof (msg as C2S).t !== "string") {
        meta.strikes++;
        send(ws, { t: "error", code: "BAD_MESSAGE", msg: "Missing type" });
        if (meta.strikes >= 3) ws.close(1008, "bad message");
        return;
      }

      const found = rooms.findPlayerBySocket(ws);

      if (found && !found.player.msgBucket.tryTake()) {
        ws.close(1008, "rate limited");
        return;
      }

      switch (msg.t) {
        case "pong":
          meta.lastPong = Date.now();
          if (found) found.player.lastPong = meta.lastPong;
          break;

        case "timePing":
          send(ws, { t: "timePong", t0: msg.t0, t1: Date.now() });
          break;

        case "createRoom": {
          if (found) return;
          const name = sanitizeName(msg.name);
          if (!name) {
            send(ws, { t: "error", code: "BAD_NAME", msg: "Invalid nickname" });
            return;
          }
          const created = rooms.create(meta.ip);
          if ("error" in created) {
            send(ws, {
              t: "error",
              code: created.error as "RATE_LIMITED" | "SERVER_FULL",
              msg: created.error,
            });
            return;
          }
          const room = created;
          const player = room.addPlayer(name, ws);
          if ("error" in player) {
            send(ws, player.error);
            rooms.destroy(room.code);
            return;
          }
          room.resyncPlayer(player);
          break;
        }

        case "joinRoom": {
          const code = (msg.code ?? "").trim();
          if (!/^\d{2}$/.test(code)) {
            send(ws, {
              t: "error",
              code: "BAD_ROOM_CODE",
              msg: "Room code must be exactly two digits",
            });
            return;
          }
          const room = rooms.get(code);
          if (!room) {
            send(ws, {
              t: "error",
              code: "ROOM_NOT_FOUND",
              msg: "Room not found",
            });
            return;
          }
          if (found) return;

          const result = room.addPlayer(msg.name, ws, msg.playerToken);
          if ("error" in result) {
            send(ws, result.error);
            return;
          }
          room.resyncPlayer(result);
          break;
        }

        default: {
          if (!found) {
            if (
              msg.t === "ready" ||
              msg.t === "startMatch" ||
              msg.t === "adjust" ||
              msg.t === "lock" ||
              msg.t === "endMatch" ||
              msg.t === "rematch" ||
              msg.t === "leave" ||
              msg.t === "sync"
            ) {
              send(ws, {
                t: "error",
                code: "BAD_PHASE",
                msg: "Not in a room",
              });
            }
            return;
          }
          found.room.handle(found.player, msg);
          break;
        }
      }
    });

    ws.on("close", () => {
      sockets.delete(meta);
      for (const room of rooms.rooms.values()) {
        room.removeSocket(ws);
      }
    });

    ws.on("error", () => {
      /* close handler cleans up */
    });
  });

  const stopHb = startHeartbeat(
    () => sockets,
    (sock) => {
      sockets.delete(sock as SockMeta);
      for (const room of rooms.rooms.values()) {
        room.removeSocket(sock.ws);
      }
    },
  );

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(PORT, HOST, () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no address"));
    });
    server.on("error", reject);
  });

  log.info("server_start", { version: VERSION, host: HOST, port });
  analytics.track("server_start", { version: VERSION });

  return {
    server,
    rooms,
    wss,
    port,
    close: async () => {
      stopHb();
      analytics.stop();
      rooms.stop();
      for (const s of sockets) {
        try {
          s.ws.close(1012, "SERVER_RESTART");
        } catch {
          /* ignore */
        }
      }
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
