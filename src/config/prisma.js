import { PrismaPg } from "@prisma/adapter-pg";
// Generated client path matches the schema's
//   generator client { output = "../generated/prisma" }
// resolving to <project root>/generated/prisma/client.js (the
// "prisma-client" generator's barrel). Update the import only if the
// generator's output filename ever changes.
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

// Pooled adapter: used for high-frequency reads and single-table queries.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });

// Direct adapter: connects directly to Postgres (bypassing PgBouncer in transaction mode),
// enabling full support for Prisma interactive multi-statement transactions ($transaction).
const directAdapter = new PrismaPg({ connectionString: env.DIRECT_URL });
export const directPrisma = new PrismaClient({ adapter: directAdapter });

export async function connectDb() {
  await prisma.$connect();
  logger.info("Prisma connected to Postgres (pooled)");
}

export async function disconnectDb() {
  await Promise.allSettled([prisma.$disconnect(), directPrisma.$disconnect()]);
  logger.info("Prisma disconnected");
}
