import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [path.join(__dirname, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: path.join(root, "dist/server.js"),
  packages: "bundle",
  alias: {
    "@pacecubs/shared": path.join(root, "shared/src/index.ts"),
  },
  banner: {
    js: `import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);`,
  },
  sourcemap: true,
  logLevel: "info",
});

console.log("server bundle → dist/server.js");
