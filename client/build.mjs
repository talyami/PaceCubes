import * as esbuild from "esbuild";
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "dist/public");
const watch = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });

function assetHash(filePath) {
  return createHash("sha256")
    .update(readFileSync(filePath))
    .digest("hex")
    .slice(0, 12);
}

function copyStatic(useHashedAssets = false) {
  const cssSource = path.join(__dirname, "styles.css");
  const appSource = path.join(outdir, "app.js");
  const cssName = useHashedAssets
    ? `styles.${assetHash(cssSource)}.css`
    : "styles.css";
  const appName = useHashedAssets
    ? `app.${assetHash(appSource)}.js`
    : "app.js";
  const index = readFileSync(path.join(__dirname, "index.html"), "utf8")
    .replace("styles.css", cssName)
    .replace("app.js", appName);
  writeFileSync(path.join(outdir, "index.html"), index);
  copyFileSync(cssSource, path.join(outdir, cssName));
  if (useHashedAssets) {
    copyFileSync(appSource, path.join(outdir, appName));
  }
  copyFileSync(
    path.join(__dirname, ".htaccess"),
    path.join(outdir, ".htaccess"),
  );
}

const buildOptions = {
  entryPoints: [path.join(__dirname, "src/main.ts")],
  bundle: true,
  outfile: path.join(outdir, "app.js"),
  format: "esm",
  target: ["es2022"],
  minify: !watch,
  sourcemap: true,
  metafile: true,
  logLevel: "info",
  alias: {
    "@yamicuberush/shared": path.join(root, "shared/src/index.ts"),
  },
};

async function run() {
  if (watch) {
    copyStatic();
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    const PORT = 5173;
    http
      .createServer((req, res) => {
        const url = req.url ?? "/";
        let filePath = path.join(
          outdir,
          url === "/" ? "index.html" : url.split("?")[0],
        );
        if (!existsSync(filePath) || !statSync(filePath).isFile()) {
          filePath = path.join(outdir, "index.html");
        }
        const ext = path.extname(filePath);
        const types = {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".map": "application/json",
        };
        res.writeHead(200, {
          "content-type": types[ext] ?? "application/octet-stream",
        });
        createReadStream(filePath).pipe(res);
      })
      .listen(PORT, () => {
        console.log(`client dev → http://127.0.0.1:${PORT}`);
        console.log("WS → ws://127.0.0.1:8081/ws (direct)");
      });
  } else {
    const result = await esbuild.build(buildOptions);
    copyStatic(true);
    if (result.metafile) {
      writeFileSync(
        path.join(root, "dist/client-meta.json"),
        JSON.stringify(result.metafile),
      );
    }
    console.log("client bundle → dist/public/app.js");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
