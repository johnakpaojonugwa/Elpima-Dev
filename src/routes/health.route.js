import { Router } from "express";
import { prisma } from "../config/prisma.js";

export const healthRouter = Router();

healthRouter.get("/", async (req, res) => {
  const startedAt = Date.now();

  // A real query, not just "the process is alive" — catches the case
  // where Express is up but the DB connection/pool is broken.
  await prisma.$queryRaw`SELECT 1`;

  res.json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    dbLatencyMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  });
});
