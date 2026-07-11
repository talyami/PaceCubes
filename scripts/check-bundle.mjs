import { readFileSync, existsSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const clientJs = path.join(root, "dist/public/app.js");
const serverJs = path.join(root, "dist/server.js");

if (!existsSync(serverJs)) {
  console.error("FAIL: dist/server.js missing");
  process.exit(1);
}
if (!existsSync(clientJs)) {
  console.error("FAIL: dist/public/app.js missing");
  process.exit(1);
}

const gz = gzipSync(readFileSync(clientJs));
const gzKb = (gz.length / 1024).toFixed(1);
const limit = 500 * 1024;

console.log(`client app.js gzip: ${gzKb} KB (limit 500 KB)`);
console.log(`server.js size: ${(statSync(serverJs).size / 1024).toFixed(1)} KB`);

if (gz.length > limit) {
  console.error(`FAIL: client bundle ${gzKb} KB gzip exceeds 500 KB`);
  process.exit(1);
}

console.log("bundle budget OK");
