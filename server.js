import { env } from "./src/config/env.js";
import { createApp } from "./src/app.js";
import { connectDb, disconnectDb } from "./src/config/prisma.js";
import { logger } from "./src/utils/logger.js";

async function main() {
  await connectDb();

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`Elpima API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  // Give in-flight requests a chance to finish and close the DB pool
  // cleanly instead of dropping connections when the process is
  // stopped/redeployed.
  //
  // The 10s force-exit timer protects against hung keep-alive sockets
  // (mobile clients, slow proxies, half-closed TCP) that would otherwise
  // keep server.close() from firing its callback until the orchestrator
  // SIGKILLs us — at which point the DB pool disconnect never runs.
  // .unref() so a stuck timer doesn't itself pin the event loop.
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down gracefully`);

    const forceExit = setTimeout(() => {
      logger.warn("forced shutdown after 10s — in-flight connections did not drain");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    server.close(async () => {
      clearTimeout(forceExit);
      await disconnectDb();
      process.exit(0);
    });
  };

  // Register signal handlers only after listen() succeeds. A signal
  // arriving before the server is ready (or after a failed startup)
  // would otherwise be routed to a half-initialized shutdown handler.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
