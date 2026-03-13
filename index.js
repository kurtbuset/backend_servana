const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
require('dotenv').config();

const { initializeSocket } = require('./socket-simple');
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

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    service: 'servana-backend'
  });
});

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
    
    // Memory monitoring
    setInterval(() => {
      const memoryUsage = process.memoryUsage();
      const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memoryUsage.heapTotal / 1024 / 1024);
      
      console.log(`💾 Memory: ${heapUsedMB}MB / ${heapTotalMB}MB`);
      
      // Alert if memory usage is high
      if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        console.error('🔴 HIGH MEMORY USAGE:', {
          heapUsed: `${heapUsedMB}MB`,
          heapTotal: `${heapTotalMB}MB`,
          rss: `${Math.round(memoryUsage.rss / 1024 / 1024)}MB`
        });
      }
    }, 60000); // Check every minute
    
    // Socket connection monitoring
    setInterval(() => {
      const socketCount = io.sockets.sockets.size;
      console.log(`🔌 Active sockets: ${socketCount}`);
      
      if (socketCount > 1000) {
        console.warn('⚠️ High socket connection count:', socketCount);
      }
    }, 60000); // Check every minute
    
    // Start the server on all network interfaces (0.0.0.0)
    server.listen(port, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${port}`);
      console.log(`🌐 Server accessible at:`);
      console.log(`   - Local: http://localhost:${port}`);
      console.log(`   - Network (Wi-Fi): http://192.168.137.77:${port}`);
      console.log(`   - Network (LAN): http://10.120.60.81:${port}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
  }
}

// Start the server
startServer();

module.exports = { app, server, io };