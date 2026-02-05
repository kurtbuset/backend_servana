const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const http = require('http');
require('dotenv').config();

const { initializeSocket } = require('./socket');
const { setupRoutes } = require('./routes');
const { getCorsConfig } = require('./config/cors.config');

const app = express();
const port = process.env.PORT || 3000;

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

server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});

module.exports = { app, server, io };