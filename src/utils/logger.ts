import pino from "pino";
import pretty from "pino-pretty";

const isDevelopment = process.env.NODE_ENV === "development";

// pino-pretty is wired in directly (not via the `transport` worker-thread
// option) because that worker thread crashes under `tsx --watch` on Node 24
// with "Error: this should not happen: undefined" (thread-stream/tsx
// incompatibility, unrelated to app code).
const prettyStream = isDevelopment
  ? pretty({
      colorize: true,
      translateTime: "SYS:HH:MM:ss.l",
      ignore: "pid,hostname,req,res,responseTime",
      singleLine: true,
    })
  : undefined;

export const logger = pino(
  {
    level: process.env.LOG_LEVEL || "info",
  },
  prettyStream,
);

export default logger;
