import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { logger } from "../utils/logger.js";

export const healthRouter = Router();

/**
 * @openapi
 * /healthz/live:
 *   get:
 *     summary: Shallow liveness probe
 *     description: Returns 200 OK if the Node.js process is up and running. Does not touch the database.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Process is alive
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */
healthRouter.get("/live", (request, response) => {
  response.status(200).json({
    status: "ok",
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * @openapi
 * /healthz/ready:
 *   get:
 *     summary: Deep readiness probe
 *     description: Verifies end-to-end database connectivity (SELECT 1). Returns 503 if unreachable.
 *     tags:
 *       - Health
 *     responses:
 *       200:
 *         description: Database is connected and healthy
 *       503:
 *         description: Database is unreachable
 */
async function checkReadiness(request, response) {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - startedAt;

    response.status(200).json({
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
      dbLatencyMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Readiness probe failed: database unreachable", {
      error: error.message,
      correlationId: request.correlationId,
    });

    response.status(503).json({
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

