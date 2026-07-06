import winston from "winston";
import { isProd } from "../config/env.js";

const { combine, timestamp, printf, colorize, errors, json } = winston.format;

const devFormat = combine(
  colorize(),
  timestamp({ format: "HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp: ts, stack }) => {
    return `${ts} ${level}: ${stack || message}`;
  }),
);

export const logger = winston.createLogger({
  level: isProd ? "info" : "debug",
  format: isProd
    ? combine(timestamp(), errors({ stack: true }), json())
    : devFormat,
  transports: [new winston.transports.Console()],
});

// morgan writes access logs through this so everything ends up
// on the same transport(s) instead of two separate log streams.
export const morganStream = {
  write: (message) => logger.info(message.trim()),
};
