const allowedOrigins = [
  process.env.REACT_WEB_URL || 'http://localhost:5173',
  process.env.REACT_WEB_PRODUCTION_URL,
  'http://localhost:5173',
  'http://localhost:8081', // Expo dev server
  'http://localhost:19006', // Expo web
  'exp://localhost:8081', // Expo mobile
].filter(Boolean);

const getCorsConfig = () => ({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedOrigins, // Export for Socket.IO
});

console.log('🌐 Allowed CORS origins:', allowedOrigins);

module.exports = { getCorsConfig };