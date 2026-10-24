import swaggerJsdoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import { env } from "./env.js";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Elpima B2B Procurement API",
      version: "1.0.0",
      description: "Medical & Surgical Equipment Procurement Platform REST API",
      contact: {
        name: "Elpima Surgicals Limited",
      },
    },
    servers: [
      {
        url: `http://localhost:${env.PORT}`,
        description: "Local development server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Supabase GoTrue JWT access token",
        },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: {
              type: "object",
              properties: {
                message: { type: "string", example: "Invalid request payload" },
                kind: { type: "string", example: "validation_error" },
                correlationId: { type: "string", example: "a3b1c2d4-e5f6-7890-abcd-ef1234567890" },
                details: { type: "object" },
              },
            },
          },
        },
        HealthResponse: {
          type: "object",
          properties: {
            status: { type: "string", example: "ok" },
            uptimeSeconds: { type: "number", example: 120 },
            timestamp: { type: "string", example: "2026-10-23T23:00:00.000Z" },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.js", "./src/modules/**/route.js"],
};

export const swaggerSpec = swaggerJsdoc(options);

/**
 * Mount Swagger UI and OpenAPI JSON documentation endpoint.
 *
 * @param {import("express").Express} app
 */
export function setupSwagger(app) {
  // Mount raw JSON endpoint before swaggerUi.serve middleware so it doesn't intercept it
  app.get("/api/v1/docs/openapi.json", (request, response) => {
    response.json(swaggerSpec);
  });

  app.use(
    "/api/v1/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      customSiteTitle: "Elpima API Documentation",
    }),
  );
}
