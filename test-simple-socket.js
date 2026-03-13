/**
 * Test script for the simplified socket implementation
 * Run this to test the new socket without breaking the existing system
 */

const express = require('express');
const http = require('http');
const { initializeSocket } = require('./socket-simple');

const app = express();
const server = http.createServer(app);

// Initialize the simplified socket on a different port for testing
const io = initializeSocket(server, ["http://localhost:3000", "http://localhost:8081"]);

app.get('/test', (req, res) => {
  res.json({ 
    message: 'Simplified socket server is running',
    connectedSockets: io.sockets.sockets.size,
    timestamp: new Date().toISOString()
  });
});

const PORT = 5001; // Different port to avoid conflicts

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🧪 Test server with simplified socket running on port ${PORT}`);
  console.log(`🌐 Test at: http://localhost:${PORT}/test`);
  console.log('📝 To test socket connection, connect clients to ws://localhost:5001');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Shutting down test server...');
  server.close(() => {
    console.log('✅ Test server closed');
    process.exit(0);
  });
});