import https from "node:https";
import crypto from "node:crypto";

function encodeClientText(text) {
  const payload = Buffer.from(text);
  const mask = crypto.randomBytes(4);
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeServerText(buf) {
  let offset = 2;
  let len = buf[1] & 0x7f;
  if (len === 126) {
    len = buf.readUInt16BE(2);
    offset = 4;
  }
  return buf.slice(offset, offset + len).toString("utf8");
}

const key = crypto.randomBytes(16).toString("base64");
const req = https.request(
    {
      host: "pacecubs-ws.icreditdept.online",
      port: 443,
      path: "/ws",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
      },
    },
    () => {},
  );

req.on("upgrade", (_res, socket) => {
  socket.write(
    encodeClientText(JSON.stringify({ t: "createRoom", name: "Smoke", level: 2 })),
  );
  socket.on("data", (buf) => {
    const text = decodeServerText(buf);
    console.log(text);
    if (text.includes('"welcome"')) {
      socket.end();
      process.exit(0);
    }
    if (text.includes('"error"')) process.exit(1);
  });
});

req.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
req.end();
setTimeout(() => {
  console.error("TIMEOUT");
  process.exit(1);
}, 5000);
