const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const http = require("http");
require("dotenv").config();
const { validateEnv } = require("./config/env.validation");
validateEnv();

const { initializeSocket } = require("./socket");
const { setupRoutes } = require("./routes");
const { getCorsConfig } = require("./config/cors.config");
const { cacheManager } = require("./helpers/redisClient");
const { globalLimiter } = require("./config/rateLimit.config");

const app = express();
const port = process.env.PORT || 5000;

// ===========================
// Middleware
// ===========================
// Trust proxy - required when behind reverse proxy (Render, Heroku, etc.)
app.set("trust proxy", 1);

app.use(helmet());
app.use(express.static("public"));
app.use(express.json());
app.use(cookieParser());
app.use(cors(getCorsConfig()));

// ===========================
// Rate Limiting
// ===========================
app.use(globalLimiter);

// ===========================
// Routes
// ===========================
// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({ status: "Server is running!" });
});

setupRoutes(app);

// Global error handler — catches unhandled errors from routes/middleware
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error:
      process.env.NODE_ENV === "production"
        ? "Internal server error"
        : err.message,
  });
});

// Health check endpoint for Docker
app.get("/health", async (req, res) => {
  const health = {
    status: "OK",
    timestamp: new Date().toISOString(),
    service: "servana-backend",
    dependencies: {},
  };

  // Check Redis
  const cache = req.app.get("cache");
  health.dependencies.redis = cache && cache.isConnected ? "ok" : "unavailable";

  const isHealthy = health.dependencies.redis === "ok";
  res.status(isHealthy ? 200 : 503).json(health);
});

// ===========================
// Socket.IO & Server Start
// ===========================
const server = http.createServer(app);
const io = initializeSocket(server, getCorsConfig().allowedOrigins);

app.set("io", io);

// ===========================
// Initialize Cache Manager & Start Server
// ===========================
let memoryMonitorInterval;
let socketMonitorInterval;
let cacheCleanupInterval;

async function startServer() {
  try {
    // Initialize Redis Cache Manager
    const cache = await cacheManager.connect();
    if (cache) {
      app.set("cache", cache);
    } else {
      console.log("⚠️ Server starting without cache (Redis unavailable)");
    }

    // Memory monitoring
    memoryMonitorInterval = setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);

      // console.log(`💾 Memory: ${heapUsedMB}MB / ${heapTotalMB}MB`);

      // Alert if memory usage is high
      if (memoryUsage.heapUsed > 500 * 1024 * 1024) {
        // 500MB
        console.error("🔴 HIGH MEMORY USAGE:", {
          heapUsed: `${heapUsedMB}MB`,
          heapTotal: `${heapTotalMB}MB`,
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`,
        });
      }
    }, 60000); // Check every minute

    // Socket connection monitoring
    socketMonitorInterval = setInterval(() => {
      const socketCount = io.sockets.sockets.size;
      // console.log(`🔌 Active sockets: ${socketCount}`);

      if (socketCount > 1000) {
        console.warn("⚠️ High socket connection count:", socketCount);
      }
    }, 60000); // Check every minute

    // Start the server on all network interfaces (0.0.0.0)
    server.listen(port, "0.0.0.0", () => {
      console.log(`🚀 Server running on port ${port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
  }
}

// Start the server
startServer();

async function shutdown(signal) {
  console.log(`\n⏹️  ${signal} received — shutting down gracefully`);

  // Clear all intervals
  clearInterval(cacheCleanupInterval);
  clearInterval(memoryMonitorInterval);
  clearInterval(socketMonitorInterval);

  // Close HTTP server (stop accepting new connections)
  server.close(async () => {
    console.log("✅ HTTP server closed");

    // Disconnect Redis
    const cache = app.get("cache");
    if (cache && cache.client) {
      try {
        await cache.client.quit();
        console.log("✅ Redis disconnected");
      } catch (err) {
        console.error("Redis disconnect error:", err.message);
      }
    }

    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error("❌ Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, io };
