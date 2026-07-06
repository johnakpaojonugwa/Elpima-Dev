import { PrismaPg } from "@prisma/adapter-pg";
// Generated client path matches your schema.prisma:
//   generator client { output = "../generated/prisma" }
// which resolves to <project root>/generated/prisma.
// NOTE: verify this exact filename after `prisma generate` — the new
// "prisma-client" generator emits a barrel file, but the exact name
// (client.js vs index.js) can vary by minor version. Adjust the
// import below to match what actually gets generated on your machine.
import { PrismaClient } from "../../generated/prisma/client.js";
import { env } from "./env.js";
import { logger } from "../utils/logger.js";

const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

// Reuse a single instance across the app (and across hot-reloads in dev)
// instead of opening a fresh connection pool per import.
export const prisma = new PrismaClient({ adapter });

export async function connectDb() {
  await prisma.$connect();
  logger.info("Prisma connected to Postgres");
}

export async function disconnectDb() {
  await prisma.$disconnect();
  logger.info("Prisma disconnected");
}
