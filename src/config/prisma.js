import { PrismaPg } from "@prisma/adapter-pg";
// Generated client path matches the schema's
//   generator client { output = "../generated/prisma" }
// resolving to <project root>/generated/prisma/client.js (the
// "prisma-client" generator's barrel). Update the import only if the
// generator's output filename ever changes.
import { PrismaClient } from "../../generated/prisma/client.js";
import { env, isProd } from "./env.js";
import { logger } from "../utils/logger.js";

// Pooled adapter: used for high-frequency reads and single-table queries.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({
  adapter,
  log: !isProd ? [{ emit: "event", level: "query" }] : [],
});

// Direct adapter: connects directly to Postgres (bypassing PgBouncer in transaction mode),
// enabling full support for Prisma interactive multi-statement transactions ($transaction).
const directAdapter = new PrismaPg({ connectionString: env.DIRECT_URL });
export const directPrisma = new PrismaClient({
  adapter: directAdapter,
  log: !isProd ? [{ emit: "event", level: "query" }] : [],
});

// Register slow query listener (>100ms) in development/test.
// Strictly omits parameters to avoid leaking credentials or PHI.
if (!isProd) {
  const attachSlowQueryLogger = (databaseClient, clientName) => {
    databaseClient.$on("query", (queryEvent) => {
      if (queryEvent.duration >= 100) {
        const queryLower = queryEvent.query.toLowerCase();
        const touchesSensitiveTable =
          queryLower.includes("license") || queryLower.includes("audit_log");

        logger.warn(`Slow database query on ${clientName} (${queryEvent.duration}ms)`, {
          client: clientName,
          durationMs: queryEvent.duration,
          query: touchesSensitiveTable ? "[REDACTED_SENSITIVE_TABLE_QUERY]" : queryEvent.query,
        });
      }
    });
  };

  attachSlowQueryLogger(prisma, "prisma:pooled");
  attachSlowQueryLogger(directPrisma, "prisma:direct");
}

export async function connectDatabase() {
  await prisma.$connect();
  logger.info("Prisma connected to Postgres (pooled)");
}

export async function disconnectDatabase() {
  await Promise.allSettled([prisma.$disconnect(), directPrisma.$disconnect()]);
  logger.info("Prisma disconnected");
}

// Backward-compatible aliases
export const connectDb = connectDatabase;
export const disconnectDb = disconnectDatabase;
