import { PrismaPg } from "@prisma/adapter-pg";
// Generated client path matches the schema's
//   generator client { output = "../generated/prisma" }
// resolving to <project root>/generated/prisma/client.js (the
// "prisma-client" generator's barrel). Update the import only if the
// generator's output filename ever changes.
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Reuse a single instance across the app (and across hot-reloads in dev)
// instead of opening a fresh connection pool per import.
export const prisma = new PrismaClient({ adapter });

export async function connectDb() {
  await prisma.$connect();
  logger.info("Prisma connected to Postgres (pooled)");
}

export async function disconnectDb() {
  await prisma.$disconnect();
  logger.info("Prisma disconnected");
}
