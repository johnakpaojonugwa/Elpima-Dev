import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";

export const healthRouter = Router();

// Shallow liveness check: does not touch external dependencies (database, cache).
// Orchestrators (Kubernetes, ECS, Fly, Render) poll this to determine if the
// container process is alive and responsive.
healthRouter.get("/live", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Deep readiness check: verifies connectivity to essential dependencies (Postgres).
// Load balancers use this to route traffic only to healthy instances.
async function checkReadiness(req, res) {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startedAt;

    res.status(200).json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      dbLatencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Readiness probe failed: database unreachable", {
      error: err.message,
      correlationId: req.correlationId,
    });

    res.status(503).json({
      status: "degraded",
      error: "Database unreachable",
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  }
}

healthRouter.get("/ready", checkReadiness);

// Backward-compatible root handler (maps to deep readiness check)
healthRouter.get("/", checkReadiness);

