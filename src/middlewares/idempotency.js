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

export function idempotency(req, res, next) {
  // Only apply to mutating requests
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    return next();
  }

  const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"];
  if (!idempotencyKey) {
    return next();
  }

  const cacheKey = `${req.user?.id || req.ip}:${req.method}:${req.baseUrl}${req.path}:${idempotencyKey}`;
  const existing = cache.get(cacheKey);

  if (existing) {
    if (existing.status === "in_flight") {
      return res.status(409).json({
        success: false,
        error: {
          message: "A request with this Idempotency-Key is currently in progress",
          kind: "idempotency_conflict",
        },
      });
    }

    // Replay cached response
    res.set("Idempotency-Replay", "true");
    if (existing.headers) {
      for (const [header, val] of Object.entries(existing.headers)) {
        if (!res.hasHeader(header)) {
          res.set(header, val);
        }
      }
    }
    return res.status(existing.statusCode).json(existing.body);
  }

  // Mark in-flight
  cache.set(cacheKey, { status: "in_flight", timestamp: Date.now() });

  const originalJson = res.json.bind(res);

  res.json = (body) => {
    // Only cache successful client operations (2xx) or definitive validation rejections (4xx)
    // 5xx internal server errors are not cached to allow safe retry
    if (res.statusCode < 500) {
      cache.set(cacheKey, {
        status: "completed",
        statusCode: res.statusCode,
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
