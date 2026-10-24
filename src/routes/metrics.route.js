import { Router } from "express";
import { register } from "../utils/metrics.js";
import { env } from "../config/env.js";

export const metricsRouter = Router();

/**
 * @openapi
 * /metrics:
 *   get:
 *     summary: Prometheus metrics endpoint
 *     description: Returns Prometheus formatted runtime, process, database, and HTTP metrics.
 *     tags:
 *       - System
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Prometheus metric text exposition format
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized when METRICS_TOKEN is configured and invalid
 */
metricsRouter.get("/", async (request, response, next) => {
  try {
    if (env.METRICS_TOKEN) {
      const authHeader = request.headers.authorization;
      const expected = `Bearer ${env.METRICS_TOKEN}`;

      if (!authHeader || authHeader !== expected) {
        return response.status(401).json({
          success: false,
          error: {
            message: "Unauthorized: Invalid or missing metrics token",
            kind: "authentication_error",
          },
        });
      }
    }

    response.set("Content-Type", register.contentType);
    const metricsData = await register.metrics();
    response.status(200).send(metricsData);
  } catch (error) {
    next(error);
  }
});
