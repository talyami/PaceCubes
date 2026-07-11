import { createApp } from "./app.js";

const app = await createApp();

function shutdown(): void {
  void app.close().then(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
