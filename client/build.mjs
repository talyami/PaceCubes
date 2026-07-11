import * as esbuild from "esbuild";
import {
  copyFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  createReadStream,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outdir = path.join(root, "dist/public");
const watch = process.argv.includes("--watch");

mkdirSync(outdir, { recursive: true });

function copyStatic() {
  copyFileSync(
    path.join(__dirname, "index.html"),
    path.join(outdir, "index.html"),
  );
  copyFileSync(
    path.join(__dirname, "styles.css"),
    path.join(outdir, "styles.css"),
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
    "@pacecubs/shared": path.join(root, "shared/src/index.ts"),
  },
};

async function run() {
  copyStatic();
  if (watch) {
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
