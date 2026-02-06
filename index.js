const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
require('dotenv').config();

const { initializeSocket } = require('./socket');
const { setupRoutes } = require('./routes');
const { getCorsConfig } = require('./config/cors.config');
const { cacheManager } = require('./helpers/redisClient');

const app = express();
const port = process.env.PORT || 5000;

// ===========================
// Middleware
// ===========================
app.use(helmet());
app.use(express.static('public'));
app.use(express.json());
app.use(cookieParser());
app.use(cors(getCorsConfig()));

// ===========================
// Routes
// ===========================
setupRoutes(app);

// ===========================
// Socket.IO & Server Start
// ===========================
const server = http.createServer(app);
const io = initializeSocket(server, getCorsConfig().allowedOrigins);

app.set('io', io);

// ===========================
// Initialize Cache Manager & Start Server
// ===========================
async function startServer() {
  try {
    // Initialize Redis Cache Manager
    const cache = await cacheManager.connect();
    if (cache) {
      app.set('cache', cache);
      console.log('🗄️ Cache Manager initialized');
      
      // Start cleanup job every 5 minutes
      setInterval(() => {
        cache.cleanup();
      }, 5 * 60 * 1000);
    } else {
      console.log('⚠️ Server starting without cache (Redis unavailable)');
    } 
    
    // Start the server on all network interfaces (0.0.0.0)
    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Server accessible at:`);
      console.log(`   - Local: http://localhost:${port}`);
      console.log(`   - Network: http://192.168.137.53:${port}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
  }
}

// Start the server
startServer();

module.exports = { app, server, io };