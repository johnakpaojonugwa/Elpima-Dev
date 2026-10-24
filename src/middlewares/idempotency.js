/**
 * Idempotency Middleware for Mutating HTTP Requests (POST, PATCH, PUT)
 *
 * Ensures repeat identical requests using the same `Idempotency-Key` header
 * produce a single consistent result without creating unintended duplicate resources
 * (e.g. duplicate quotes or orders caused by mobile network retries).
 */

const cache = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours retention

// Periodically clean expired keys every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > TTL_MS) {
      cache.delete(key);
    }
  }
}, 60 * 60 * 1000).unref();

export function idempotency(request, response, next) {
  // Only apply to mutating requests
  if (request.method === "GET" || request.method === "HEAD" || request.method === "OPTIONS") {
    return next();
  }

  const idempotencyKey = request.headers["idempotency-key"] || request.headers["x-idempotency-key"];
  if (!idempotencyKey) {
    return next();
  }

  const cacheKey = `${request.user?.id || request.ip}:${request.method}:${request.baseUrl}${request.path}:${idempotencyKey}`;
  const existing = cache.get(cacheKey);

  if (existing) {
    if (existing.status === "in_flight") {
      return response.status(409).json({
        success: false,
        error: {
          message: "A request with this Idempotency-Key is currently in progress",
          kind: "idempotency_conflict",
        },
      });
    }

    // Replay cached response
    response.set("Idempotency-Replay", "true");
    if (existing.headers) {
      for (const [header, headerValue] of Object.entries(existing.headers)) {
        if (!response.hasHeader(header)) {
          response.set(header, headerValue);
        }
      }
    }
    return response.status(existing.statusCode).json(existing.body);
  }

  // Mark in-flight
  cache.set(cacheKey, { status: "in_flight", timestamp: Date.now() });

  const originalJson = response.json.bind(response);

  response.json = (body) => {
    // Only cache successful client operations (2xx) or definitive validation rejections (4xx)
    // 5xx internal server errors are not cached to allow safe retry
    if (response.statusCode < 500) {
      cache.set(cacheKey, {
        status: "completed",
        statusCode: response.statusCode,
        body,
        headers: {
          "content-type": "application/json",
        },
        timestamp: Date.now(),
      });
    } else {
      cache.delete(cacheKey);
    }

    return originalJson(body);
  };

  next();
}

/**
 * Test helper to clear cache in test suites
 */
export function clearIdempotencyCache() {
  cache.clear();
}
