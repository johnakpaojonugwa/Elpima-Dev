import client from "prom-client";

// Global Prometheus metrics registry
export const register = new client.Registry();

// Standard process & runtime metrics (GC, memory, event loop, CPU)
client.collectDefaultMetrics({
  register,
  prefix: "elpima_",
});

// HTTP Request Duration Histogram
export const httpRequestDurationSeconds = new client.Histogram({
  name: "elpima_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// Total HTTP Requests Counter
export const httpRequestsTotal = new client.Counter({
  name: "elpima_http_requests_total",
  help: "Total number of HTTP requests processed",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// Total HTTP Errors Counter (4xx, 5xx)
export const httpErrorsTotal = new client.Counter({
  name: "elpima_http_errors_total",
  help: "Total number of HTTP error responses returned",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

// Database Query Duration Histogram
export const dbQueryDurationSeconds = new client.Histogram({
  name: "elpima_db_query_duration_seconds",
  help: "Duration of database queries executed via Prisma in seconds",
  labelNames: ["model", "action"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

/**
 * Express middleware to record HTTP metrics per request.
 * Normalizes parameterized paths (e.g. /api/v1/products/:id) to avoid high cardinality.
 */
export function metricsMiddleware(request, response, next) {
  // Ignore /metrics scrapes from self-metrics to avoid feedback loops
  if (request.path === "/metrics") {
    return next();
  }

  const startHrTime = process.hrtime.bigint();

  response.on("finish", () => {
    const endHrTime = process.hrtime.bigint();
    const durationInSeconds = Number(endHrTime - startHrTime) / 1e9;

    // Resolve route pattern if available from Express router layer,
    // otherwise fallback to a generic pattern to prevent label explosion.
    let route = request.baseUrl || "";
    if (request.route?.path) {
      route += request.route.path === "/" && route.length > 0 ? "" : request.route.path;
    } else {
      // In case route handler didn't attach request.route (e.g. 404s)
      route = request.path || "unknown";
    }

    const labels = {
      method: request.method,
      route,
      status_code: response.statusCode.toString(),
    };

    httpRequestDurationSeconds.observe(labels, durationInSeconds);
    httpRequestsTotal.inc(labels);

    if (response.statusCode >= 400) {
      httpErrorsTotal.inc(labels);
    }
  });

  next();
}
