import express, { Request, Response, ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

// Import routes
import authRoutes from "./routes/auth.js";
import connectionRoutes from "./routes/connections.js";
import queryRoutes from "./routes/queries.js";
import chartRoutes from "./routes/charts.js";
import dashboardRoutes from "./routes/dashboards.js";
import componentRoutes from "./routes/components.js";
import datasetRoutes from "./routes/datasets.js";

import { logger } from "./utils/logger.js";
import { pinoHttp } from "pino-http";

// Import database initialization
import { initializeDatabase } from "./config/database.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Ensure data directory exists
const dataDir = join(__dirname, "../data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize the app database
await initializeDatabase();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// Logger middleware
app.use(
  pinoHttp({
    logger,
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) {
        return "error";
      }
      if (res.statusCode >= 400) {
        return "warn";
      }
      return "info";
    },
    customSuccessMessage: (req, res, responseTime) => {
      return `[${req.method}] ${req.url} ➔ ${res.statusCode} (${responseTime}ms)`;
    },
    customErrorMessage: (req, res, error) => {
      return `[${req.method}] ${req.url} ➔ ${res.statusCode} - ${error.message}`;
    },
    serializers: {
      req: (req) => ({
        method: req.method,
        url: req.url,
      }),
      res: (res) => ({
        statusCode: res.statusCode,
      }),
    },
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: { error: "Too many requests, please try again later." },
});
app.use(limiter);

// CORS configuration - allows connecting from any frontend
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim())
  : ["http://localhost:5173", "http://localhost:3000"];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);

      // In development, allow all origins
      if (process.env.NODE_ENV === "development") {
        return callback(null, true);
      }

      if (corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/connections", connectionRoutes);
app.use("/api/queries", queryRoutes);
app.use("/api/charts", chartRoutes);
app.use("/api/dashboards", dashboardRoutes);
app.use("/api/components", componentRoutes);
app.use("/api/datasets", datasetRoutes);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error(err, "Error:");
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
};
app.use(errorHandler);



app.listen(PORT, () => {
  logger.info(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Uptake Backend Server                                ║
║                                                           ║
║   Running on: http://localhost:${PORT}                     ║
║   Environment: ${process.env.NODE_ENV || "development"}                        ║
║                                                           ║
║   API Endpoints:                                          ║
║   • GET  /api/health        - Health check                ║
║   • POST /api/auth/login    - User login                  ║
║   • POST /api/auth/register - User registration           ║
║   • /api/connections/*      - Database connections        ║
║   • /api/queries/*          - SQL queries                 ║
║   • /api/charts/*           - Chart management            ║
║   • /api/dashboards/*       - Dashboard management        ║
   ║   • /api/datasets/*         - Dataset management          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

export default app;
