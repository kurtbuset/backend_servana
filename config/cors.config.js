const allowedOrigins = [
  process.env.REACT_WEB_URL || 'http://localhost:5173',
  process.env.REACT_WEB_PRODUCTION_URL,
  'http://localhost:5173',
  'http://localhost:8081', // Expo dev server
  'http://localhost:19006', // Expo web
  'exp://localhost:8081', // Expo mobile
  'http://172.20.176.1:8081', // Mobile app on network
].filter(Boolean);

const getCorsConfig = () => ({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }
    
    // Allow if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Allow any origin starting with http://172.20.176 (your network)
    if (origin.startsWith('http://172.20.176')) {
      return callback(null, true);
    }
    
    // Allow any origin starting with http://192.168 (common home networks)
    if (origin.startsWith('http://192.168')) {
      return callback(null, true);
    }
    
    // Allow any origin starting with http://10. (corporate networks)
    if (origin.startsWith('http://10.')) {
      return callback(null, true);
    }
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  allowedOrigins, // Export for Socket.IO
});

console.log('🌐 Allowed CORS origins:', allowedOrigins);
console.log('🔓 CORS: Allowing mobile app connections from local network');

module.exports = { getCorsConfig };