import winston from "winston";
import { isProd } from "../config/env.js";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf((info) => {
    const {
      timestamp: ts,
      level,
      message,
      stack,
      correlationId,
      method,
      url,
      status,
      durationMs,
    } = info;
    const summary = stack || message;
    const accessLine =
      correlationId && method
        ? ` ${method} ${url} ${status} ${durationMs}ms [${correlationId}]`
        : "";
    return `${ts} ${level}: ${summary}${accessLine}`;
  }),
);

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: isProd
    ? combine(timestamp(), errors({ stack: true }), json())
    : devFormat,
  transports: [new winston.transports.Console()],
});

// Access log stream for morgan. The custom morgan format in app.js
// emits a JSON-encoded line containing both a short human summary
// (`msg`) and the structured fields (correlationId, method, url,
// status, durationMs, userId, organizationId, ip). This stream
// parses that line and forwards the fields to winston.
//
// The parse is wrapped in try/catch so a future contributor who
// adds a stray `{` to the format string fails gracefully — the
// access log falls back to a plain `info` line instead of crashing
// the process.
export const morganStream = {
  write(line) {
    try {
      const record = JSON.parse(line);
      logger.info(record.msg ?? "http_request", record);
    } catch {
      logger.info(line.trim());
    }
  },
};
